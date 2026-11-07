// Wire types for the draft sync protocol. See PROTOCOL.md.
// Pure TypeScript with no runtime dependencies, so the Node core and the Convex functions share it.

export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

export const LIMITS = {
  /** Largest decoded payload. Convex documents are capped at 1 MiB, so this leaves headroom. */
  maxRecordBytes: 512 * 1024,
  maxBatchRecords: 100,
  /** Largest decoded payload bytes in one push. */
  maxBatchBytes: 2 * 1024 * 1024,
  /** Largest request body, JSON and base64 included. */
  maxBodyBytes: 4 * 1024 * 1024,
  defaultPullLimit: 200,
  maxPullLimit: 500,
  /** A pull page stops once it has this many payload bytes (it always returns at least one record). */
  maxPullBytes: 1024 * 1024,
} as const;

export type ServerKind = "lean" | "postgres" | "convex";

/** A record as it travels: payload is base64 of opaque bytes. */
export interface WireRecord {
  entity: string;
  uuid: string;
  version: number;
  deleted: boolean;
  schemaVersion: number;
  payload: string;
}

export interface WireChange {
  entity: string;
  uuid: string;
  /** The version the device last saw for this record; 0 for a record it believes is new. */
  baseVersion: number;
  deleted: boolean;
  schemaVersion: number;
  payload: string;
}

export interface SyncRequest {
  protocolVersion: number;
  /** Informational only; the server trusts the token's device, not this field. */
  deviceId?: string;
  /** Random id. A retry carries the same one and gets the same applied/conflicts back. */
  batchId: string;
  /** Last version this device has pulled. 0 on first sync. */
  cursor: number;
  /** The epoch the device last saw; absent on first sync. */
  epoch?: string;
  changes: WireChange[];
  /** Records to pull back in this response. 0 means push only. */
  pullLimit?: number;
}

export interface Applied {
  entity: string;
  uuid: string;
  version: number;
}

export interface Conflict {
  entity: string;
  uuid: string;
  /** The record as the server has it, or null when the server has no such record (a stale baseVersion). */
  current: WireRecord | null;
}

export type ResyncReason = "epoch" | "cursor_ahead";

export interface SyncResponse {
  protocolVersion: number;
  epoch: string;
  /** The user's highest assigned version when the response was built. */
  head: number;
  applied: Applied[];
  conflicts: Conflict[];
  /** Records with version > request cursor, ascending. May include the device's own writes. */
  changes: WireRecord[];
  /** Continue pulling from here. */
  cursor: number;
  more: boolean;
  /** When set, nothing was applied or returned: restart from cursor 0 under the new epoch. */
  resync?: ResyncReason;
}

export type HintInfo =
  | { kind: "sse"; path: string }
  | { kind: "convex-query"; deploymentUrl: string; query: string };

export interface InfoResponse {
  protocolVersion: number;
  minProtocolVersion: number;
  draft: true;
  server: ServerKind;
  epoch: string;
  limits: typeof LIMITS;
  hint: HintInfo;
}

/** What a change hint carries: the head moved. The device then calls /v1/sync. */
export interface Hint {
  head: number;
  epoch: string;
}

export interface ErrorBody {
  error: { code: string; message: string };
}

/** A record decoded for storage. */
export interface StoredRecord {
  entity: string;
  uuid: string;
  version: number;
  deleted: boolean;
  schemaVersion: number;
  payload: Uint8Array;
}

export interface ParsedChange {
  entity: string;
  uuid: string;
  baseVersion: number;
  deleted: boolean;
  schemaVersion: number;
  payload: Uint8Array;
}

export interface ParsedSyncRequest {
  protocolVersion: number;
  deviceId?: string;
  batchId: string;
  cursor: number;
  epoch?: string;
  changes: ParsedChange[];
  pullLimit: number;
}

/** The outcome of one push, kept so a retry of the same batch returns the same answer. */
export interface PushResult {
  applied: Applied[];
  conflicts: Conflict[];
  head: number;
}
