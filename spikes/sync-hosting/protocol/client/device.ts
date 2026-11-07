// A simulated device: a tiny local store plus just enough of the design's sync engine to exercise a server.
// It is NOT the real engine (that does not exist yet; this feeds spike S3 and Gate B). It keeps the parts
// that decide whether a server is correct: an outbox keyed by record, a pending batch that is retried
// byte-for-byte with the same batchId, the design's conflict rule (first to the server wins, the loser is
// kept as a conflict copy), and a full resync when the server's epoch changes.

import { decodeBase64, encodeBase64 } from "../b64.ts";
import { PROTOCOL_VERSION, type SyncRequest, type SyncResponse, type WireChange, type WireRecord } from "../types.ts";
import { equalBytes, newBatchId, newUuid, sleep } from "./bytes.ts";
import type { HintSource } from "./hints.ts";
import { TransportError, type Transport, type TransportStats } from "./transport.ts";

export interface LocalRecord {
  entity: string;
  uuid: string;
  payload: Uint8Array;
  deleted: boolean;
  /** The server version this record is based on. 0 = never synced. */
  version: number;
  dirty: boolean;
  /** During a resync: not yet matched against the server's copy. */
  reconcile: boolean;
}

export interface DeviceOptions {
  name: string;
  transport: Transport;
  /** Wait for typing to pause this long before pushing; every write restarts it. 0 = push at once (scenarios); the design uses 2000. */
  pushDebounceMs?: number;
  /** ...but never hold the first unsent write longer than this (the design: 10 s). */
  pushMaxWaitMs?: number;
  pullLimit?: number;
  batchRecords?: number;
  batchBytes?: number;
  retry?: { baseMs: number; maxMs: number };
  /** A remote record has been applied to the local store. */
  onRemote?: (e: { key: string; version: number; deleted: boolean; payload: Uint8Array; at: number }) => void;
  /** Start from a saved local state, as a device that was switched off and is coming back. */
  initial?: DeviceState;
  /** A push got its acknowledgement. */
  onAck?: (e: { changes: number; ms: number; at: number }) => void;
}

export interface DeviceState {
  records: Map<string, LocalRecord>;
  cursor: number;
  epoch: string | undefined;
}

export interface DeviceStats {
  cycles: number;
  pushes: number;
  pulls: number;
  retries: number;
  conflicts: number;
  conflictCopies: number;
  resyncs: number;
  repushed: number;
  /** Times the server answered an error or the network failed, with timestamps (performance.now()). */
  failures: { at: number; message: string }[];
  /** First success after each failure streak. */
  recoveries: { at: number }[];
}

interface PendingBatch {
  batchId: string;
  changes: WireChange[];
  sent: Map<string, { payload: Uint8Array; deleted: boolean }>;
}

const key = (entity: string, uuid: string) => `${entity}/${uuid}`;

export class Device {
  readonly name: string;
  readonly records = new Map<string, LocalRecord>();
  readonly stats: DeviceStats = {
    cycles: 0,
    pushes: 0,
    pulls: 0,
    retries: 0,
    conflicts: 0,
    conflictCopies: 0,
    resyncs: 0,
    repushed: 0,
    failures: [],
    recoveries: [],
  };
  cursor = 0;
  epoch: string | undefined;

  private readonly opts: Required<Pick<DeviceOptions, "pushDebounceMs" | "pushMaxWaitMs" | "pullLimit" | "batchRecords" | "batchBytes" | "retry">> & DeviceOptions;
  private readonly dirty = new Set<string>();
  private pending: PendingBatch | null = null;
  private reconciling = false;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private hintTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private failing = false;
  private hints: HintSource | null = null;
  private wake: (() => void) | null = null;
  /** An explicit syncNow() or an "unknown, go and look" hint: do a round trip even if nothing looks new. */
  private needPull = true;
  /** The highest head any hint has told us about. A pull is due while this is ahead of the cursor. */
  private hintHead = 0;
  /** Local edits are waiting out the push debounce: a cycle that runs now (a hint) may pull but must not push them. */
  private pushHeld = false;
  private firstUnsentAt: number | null = null;
  lastError: Error | null = null;

  constructor(opts: DeviceOptions) {
    this.name = opts.name;
    this.opts = {
      pushDebounceMs: 0,
      pushMaxWaitMs: 10_000,
      pullLimit: 200,
      batchRecords: 100,
      batchBytes: 1_500_000,
      retry: { baseMs: 200, maxMs: 3000 },
      ...opts,
    };
    if (opts.initial) {
      for (const [k, rec] of opts.initial.records) {
        this.records.set(k, { ...rec, reconcile: false });
        if (rec.dirty) this.dirty.add(k);
      }
      this.cursor = opts.initial.cursor;
      this.epoch = opts.initial.epoch;
    }
  }

  /** A copy of the local state, to start a "returning" device from. */
  exportState(): DeviceState {
    return { records: new Map([...this.records].map(([k, r]) => [k, { ...r }])), cursor: this.cursor, epoch: this.epoch };
  }

  // ── local edits ────────────────────────────────────────────────────────────

  edit(entity: string, uuid: string, payload: Uint8Array): void {
    const k = key(entity, uuid);
    const rec = this.records.get(k);
    if (rec) {
      rec.payload = payload;
      rec.deleted = false;
      rec.dirty = true;
    } else {
      this.records.set(k, { entity, uuid, payload, deleted: false, version: 0, dirty: true, reconcile: false });
    }
    this.dirty.add(k);
    this.kick();
  }

  remove(entity: string, uuid: string): void {
    const k = key(entity, uuid);
    const rec = this.records.get(k);
    if (!rec) return;
    rec.deleted = true;
    rec.payload = new Uint8Array(0);
    rec.dirty = true;
    this.dirty.add(k);
    this.kick();
  }

  get(entity: string, uuid: string): LocalRecord | undefined {
    return this.records.get(key(entity, uuid));
  }

  dirtyCount(): number {
    return this.dirty.size;
  }

  get transport(): Transport {
    return this.opts.transport;
  }

  get transportStats(): TransportStats {
    return this.opts.transport.stats;
  }

  // ── scheduling ─────────────────────────────────────────────────────────────

  /** Attach a hint stream: every hint that is news triggers a sync. */
  attachHints(source: HintSource): void {
    this.hints = source;
  }

  /** Called by a hint source. `undefined` means "unknown, go and look". */
  onHint(hint: { head: number; epoch: string } | undefined): void {
    if (!hint) {
      this.needPull = true;
    } else if (hint.epoch !== this.epoch || hint.head < this.cursor) {
      // A new epoch, or a head BELOW the cursor (history went backwards): go and look; the server will say resync.
      this.needPull = true;
    } else {
      // Our own push produces a hint too, usually before we have processed its response. Remember how far it says
      // the server is; if the response already took the cursor that far, no request is needed.
      this.hintHead = Math.max(this.hintHead, hint.head);
      if (hint.head === this.cursor) return;
    }
    this.kick(true);
  }

  /**
   * Ask for a sync. A local edit (default) waits for typing to pause, restarting on every write, but no longer than
   * the max wait since the first unsent write. A hint (`immediate`) looks at the server now; unsent edits stay held.
   */
  kick(immediate = false): void {
    if (this.stopped) return;
    if (immediate) {
      if (this.running) {
        this.again = true;
        return;
      }
      if (this.hintTimer) return;
      this.hintTimer = setTimeout(() => {
        this.hintTimer = null;
        this.run();
      }, 0);
      return;
    }
    const now = performance.now();
    this.firstUnsentAt ??= now;
    const wait = Math.max(0, Math.min(this.opts.pushDebounceMs, this.firstUnsentAt + this.opts.pushMaxWaitMs - now));
    this.pushHeld = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.firstUnsentAt = null;
      this.pushHeld = false;
      this.run();
    }, wait);
  }

  private run(): void {
    this.syncNow(false).catch((err: unknown) => {
      this.lastError = err instanceof Error ? err : new Error(String(err));
    });
  }

  /**
   * Run a sync cycle and resolve when the device is quiescent (nothing dirty, cursor at the head).
   * An explicit call flushes any held edits and always does at least one round trip; internal kicks skip the
   * round trip when nothing is news.
   */
  syncNow(force = true): Promise<void> {
    if (force) {
      this.needPull = true;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.firstUnsentAt = null;
      this.pushHeld = false;
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.cycle();
        } while (this.again && !this.stopped);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hints?.close();
    this.wake?.();
  }

  // ── the sync cycle ─────────────────────────────────────────────────────────

  private async cycle(): Promise<void> {
    const hinted = this.hintHead > this.cursor;
    const sendable = this.dirty.size > 0 && !this.pushHeld;
    if (!this.needPull && !hinted && !sendable && !this.pending && !this.reconciling) return;
    this.needPull = false;
    this.stats.cycles += 1;
    for (let guard = 0; guard < 100_000 && !this.stopped; guard++) {
      const batch = this.pending ?? (this.reconciling || this.pushHeld ? null : this.buildBatch());
      const moreBatchesAfter = batch !== null && this.dirty.size > batch.changes.length;
      const req: SyncRequest = {
        protocolVersion: PROTOCOL_VERSION,
        deviceId: this.name,
        batchId: batch?.batchId ?? newBatchId(),
        cursor: this.cursor,
        epoch: this.epoch,
        changes: batch?.changes ?? [],
        // While uploading a long run of batches there is nothing to gain from pulling between them.
        pullLimit: moreBatchesAfter ? 0 : this.opts.pullLimit,
      };

      const started = performance.now();
      const resp = await this.send(req);
      if (resp === null) return; // stopped
      if (batch) this.opts.onAck?.({ changes: batch.changes.length, ms: performance.now() - started, at: performance.now() });
      if (batch) this.stats.pushes += 1;
      if (req.pullLimit! > 0) this.stats.pulls += 1;

      if (resp.resync) {
        this.beginReconcile(resp);
        continue;
      }
      this.epoch ??= resp.epoch;

      if (batch) {
        this.applyPush(batch, resp);
        this.pending = null;
        // Pull-less push: if our writes were the next versions after the cursor, nobody interleaved and
        // we can move the cursor past them instead of downloading our own writes back.
        if (req.pullLimit === 0) this.advancePastOwnWrites(resp);
      }
      for (const rec of resp.changes) this.applyRemote(rec);
      if (req.pullLimit! > 0) this.cursor = resp.cursor;
      if (this.reconciling && !resp.more && req.pullLimit! > 0) this.finishReconcile();

      const behind = this.cursor < resp.head || resp.more;
      const unsent = this.dirty.size > 0 && !this.pushHeld;
      if (!behind && !unsent && !this.reconciling && this.pending === null) return;
    }
  }

  private async send(req: SyncRequest): Promise<SyncResponse | null> {
    let delay = this.opts.retry.baseMs;
    while (!this.stopped) {
      try {
        const resp = await this.opts.transport.sync(req);
        if (this.failing) {
          this.failing = false;
          this.stats.recoveries.push({ at: performance.now() });
        }
        return resp;
      } catch (err) {
        if (!(err instanceof TransportError) || !err.retryable) throw err;
        this.failing = true;
        this.stats.retries += 1;
        this.stats.failures.push({ at: performance.now(), message: err.message });
        // The request body, batchId included, is kept in `this.pending`/`req`: a retry is byte-for-byte the same.
        if (!this.pending && req.changes.length > 0) throw new Error("invariant: a push in flight must be pending");
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, delay * (0.5 + Math.random()));
          this.wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        this.wake = null;
        delay = Math.min(delay * 2, this.opts.retry.maxMs);
      }
    }
    return null;
  }

  private buildBatch(): PendingBatch | null {
    if (this.dirty.size === 0) return null;
    const changes: WireChange[] = [];
    const sent = new Map<string, { payload: Uint8Array; deleted: boolean }>();
    let bytes = 0;
    for (const k of this.dirty) {
      const rec = this.records.get(k)!;
      if (changes.length > 0 && (changes.length >= this.opts.batchRecords || bytes + rec.payload.length > this.opts.batchBytes)) break;
      changes.push({
        entity: rec.entity,
        uuid: rec.uuid,
        baseVersion: rec.version,
        deleted: rec.deleted,
        schemaVersion: 1,
        payload: encodeBase64(rec.payload),
      });
      sent.set(k, { payload: rec.payload, deleted: rec.deleted });
      bytes += rec.payload.length;
    }
    this.pending = { batchId: newBatchId(), changes, sent };
    return this.pending;
  }

  private applyPush(batch: PendingBatch, resp: SyncResponse): void {
    for (const a of resp.applied) {
      const k = key(a.entity, a.uuid);
      const rec = this.records.get(k);
      const sent = batch.sent.get(k);
      if (!rec || !sent) continue;
      rec.version = a.version;
      // Edited again while the push was in flight: it stays dirty and goes next on top of this version.
      if (rec.payload === sent.payload && rec.deleted === sent.deleted) {
        rec.dirty = false;
        this.dirty.delete(k);
      }
    }
    for (const c of resp.conflicts) this.resolveConflict(key(c.entity, c.uuid), c.current);
  }

  private advancePastOwnWrites(resp: SyncResponse): void {
    const versions = resp.applied.map((a) => a.version).sort((x, y) => x - y);
    if (versions.length === 0) return;
    const contiguous = versions.every((v, i) => v === this.cursor + 1 + i);
    if (contiguous) this.cursor = versions[versions.length - 1]!;
  }

  /** A record from the server, either a conflict's `current` or a pulled change. */
  private applyRemote(remote: WireRecord): void {
    const k = key(remote.entity, remote.uuid);
    const local = this.records.get(k);
    const payload = decodeBase64(remote.payload) ?? new Uint8Array(0);

    if (local?.reconcile) {
      // Resync: this is the first time we see the server's copy of a record we already hold.
      local.reconcile = false;
      local.version = remote.version;
      if (local.deleted === remote.deleted && equalBytes(local.payload, payload)) {
        local.dirty = false;
        this.dirty.delete(k);
      } else {
        // Our copy differs from the restored server's. After a restore the device is the better source,
        // so push ours on top of the server's version.
        local.dirty = true;
        this.dirty.add(k);
        this.stats.repushed += 1;
      }
      return;
    }
    if (local && remote.version <= local.version) return; // already have it (includes echoes of our own writes)
    if (local?.dirty) {
      this.resolveConflict(k, remote);
      return;
    }
    this.records.set(k, {
      entity: remote.entity,
      uuid: remote.uuid,
      payload,
      deleted: remote.deleted,
      version: remote.version,
      dirty: false,
      reconcile: false,
    });
    this.opts.onRemote?.({ key: k, version: remote.version, deleted: remote.deleted, payload, at: performance.now() });
  }

  /**
   * The design's rules: the first writer to reach the server wins; the loser's text is kept as a new
   * "conflict copy" record so nothing is lost. An edit beats a delete.
   */
  private resolveConflict(k: string, current: WireRecord | null): void {
    const local = this.records.get(k);
    if (!local) return;
    this.stats.conflicts += 1;
    if (current === null) {
      // The server has no such record (stale baseVersion): push it again as new.
      local.version = 0;
      return;
    }
    const remotePayload = decodeBase64(current.payload) ?? new Uint8Array(0);
    if (local.deleted === current.deleted && equalBytes(local.payload, remotePayload)) {
      // Same content on both sides is not a conflict: accept the server's version.
      local.version = current.version;
      local.dirty = false;
      this.dirty.delete(k);
      return;
    }
    if (current.deleted && !local.deleted) {
      // Local edit against a remote delete: the edit wins, re-pushed as an undelete on the tombstone.
      local.version = current.version;
      return;
    }
    if (!local.deleted) {
      const copy = newUuid();
      this.records.set(key(local.entity, copy), {
        entity: local.entity,
        uuid: copy,
        payload: local.payload,
        deleted: false,
        version: 0,
        dirty: true,
        reconcile: false,
      });
      this.dirty.add(key(local.entity, copy));
      this.stats.conflictCopies += 1;
    }
    // Adopt the winner.
    local.payload = remotePayload;
    local.deleted = current.deleted;
    local.version = current.version;
    local.dirty = false;
    this.dirty.delete(k);
    this.opts.onRemote?.({ key: k, version: current.version, deleted: current.deleted, payload: remotePayload, at: performance.now() });
  }

  // ── resync after a server epoch change ─────────────────────────────────────

  private beginReconcile(resp: SyncResponse): void {
    this.stats.resyncs += 1;
    this.epoch = resp.epoch;
    this.cursor = 0;
    this.hintHead = 0; // hints described the old history
    this.pending = null; // nothing was applied; its records are still dirty
    this.reconciling = true;
    for (const rec of this.records.values()) {
      rec.reconcile = true;
      rec.version = 0;
    }
  }

  private finishReconcile(): void {
    // Whatever the server did not mention it lacks: push it as new.
    for (const [k, rec] of this.records) {
      if (!rec.reconcile) continue;
      rec.reconcile = false;
      rec.dirty = true;
      this.dirty.add(k);
      this.stats.repushed += 1;
    }
    this.reconciling = false;
  }
}

/** Wait until every device is quiescent and agrees. Used by scenarios after faults. */
export async function settle(devices: Device[], timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    await Promise.all(devices.map((d) => d.syncNow()));
    if (devices.every((d) => d.dirtyCount() === 0)) return;
    if (performance.now() > deadline) throw new Error(`devices did not settle within ${timeoutMs} ms`);
    await sleep(50);
  }
}
