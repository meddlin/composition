// SQLite adapter for the lean setup: one file on the VM's disk, replicated by Litestream.
// node:sqlite is synchronous and the process is single-threaded, so one push is one uninterrupted
// BEGIN IMMEDIATE ... COMMIT: versions come out gap-free with no lock to engineer (design: "How the lean
// setup works"). The async interface is only there so the Postgres adapter can share it.

import { DatabaseSync } from "node:sqlite";
import { BATCH_RETENTION_MS, newEpoch, type PullPage, type SyncStorage } from "../core/storage.ts";
import type { Applied, Conflict, ParsedChange, PushResult, StoredRecord } from "../protocol/types.ts";
import { encodeBase64 } from "../protocol/b64.ts";

interface RecordRow {
  entity: string;
  uuid: string;
  version: number;
  deleted: number;
  schema_version: number;
  payload: Uint8Array;
}

function toStored(row: RecordRow): StoredRecord {
  return {
    entity: row.entity,
    uuid: row.uuid,
    version: row.version,
    deleted: row.deleted === 1,
    schemaVersion: row.schema_version,
    payload: row.payload,
  };
}

export class SqliteStorage implements SyncStorage {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  async init(): Promise<void> {
    // WAL so pulls never block pushes; NORMAL is Litestream's recommendation (a crash can lose the last
    // commits, which the replica and the devices' re-push cover). busy_timeout covers Litestream's checkpoints.
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_seq (user_id TEXT PRIMARY KEY, head INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
        user_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        uuid TEXT NOT NULL,
        version INTEGER NOT NULL,
        deleted INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        payload BLOB NOT NULL,
        size INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, entity, uuid)
      ) WITHOUT ROWID;
      CREATE UNIQUE INDEX IF NOT EXISTS records_by_version ON records (user_id, version);
      CREATE TABLE IF NOT EXISTS batches (
        user_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        response TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, batch_id)
      ) WITHOUT ROWID;
    `);
    this.db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('epoch', ?)").run(newEpoch());
    this.purgeBatches();
  }

  private purgeBatches(): void {
    this.db.prepare("DELETE FROM batches WHERE created_at < ?").run(Date.now() - BATCH_RETENTION_MS);
  }

  async epoch(): Promise<string> {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'epoch'").get() as { value: string } | undefined;
    if (!row) throw new Error("epoch missing");
    return row.value;
  }

  async rotateEpoch(): Promise<string> {
    const epoch = newEpoch();
    this.db.prepare("UPDATE meta SET value = ? WHERE key = 'epoch'").run(epoch);
    return epoch;
  }

  async head(userId: string): Promise<number> {
    const row = this.db.prepare("SELECT head FROM user_seq WHERE user_id = ?").get(userId) as { head: number } | undefined;
    return row?.head ?? 0;
  }

  async applyBatch(userId: string, batchId: string, changes: ParsedChange[]): Promise<PushResult & { replayed: boolean }> {
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = db.prepare("SELECT response FROM batches WHERE user_id = ? AND batch_id = ?").get(userId, batchId) as
        | { response: string }
        | undefined;
      if (prior) {
        db.exec("COMMIT");
        return { ...(JSON.parse(prior.response) as PushResult), replayed: true };
      }

      const seq = db.prepare("SELECT head FROM user_seq WHERE user_id = ?").get(userId) as { head: number } | undefined;
      let head = seq?.head ?? 0;
      const getRecord = db.prepare(
        "SELECT entity, uuid, version, deleted, schema_version, payload FROM records WHERE user_id = ? AND entity = ? AND uuid = ?",
      );
      const upsert = db.prepare(`
        INSERT INTO records (user_id, entity, uuid, version, deleted, schema_version, payload, size, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, entity, uuid) DO UPDATE SET
          version = excluded.version, deleted = excluded.deleted, schema_version = excluded.schema_version,
          payload = excluded.payload, size = excluded.size, updated_at = excluded.updated_at
      `);

      const applied: Applied[] = [];
      const conflicts: Conflict[] = [];
      const now = Date.now();
      for (const change of changes) {
        const current = getRecord.get(userId, change.entity, change.uuid) as RecordRow | undefined;
        const currentVersion = current?.version ?? 0;
        if (change.baseVersion !== currentVersion) {
          conflicts.push({
            entity: change.entity,
            uuid: change.uuid,
            current: current ? { ...toStored(current), payload: encodeBase64(current.payload) } : null,
          });
          continue;
        }
        head += 1;
        upsert.run(userId, change.entity, change.uuid, head, change.deleted ? 1 : 0, change.schemaVersion, change.payload, change.payload.length, now);
        applied.push({ entity: change.entity, uuid: change.uuid, version: head });
      }

      if (applied.length > 0) {
        db.prepare("INSERT INTO user_seq (user_id, head) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET head = excluded.head").run(
          userId,
          head,
        );
      }
      const result: PushResult = { applied, conflicts, head };
      db.prepare("INSERT INTO batches (user_id, batch_id, response, created_at) VALUES (?, ?, ?, ?)").run(
        userId,
        batchId,
        JSON.stringify(result),
        now,
      );
      db.exec("COMMIT");
      return { ...result, replayed: false };
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // already rolled back by SQLite
      }
      throw err;
    }
  }

  async pull(userId: string, cursor: number, limit: number, maxBytes: number): Promise<PullPage> {
    const head = await this.head(userId);
    const stmt = this.db.prepare(
      `SELECT entity, uuid, version, deleted, schema_version, payload FROM records
       WHERE user_id = ? AND version > ? ORDER BY version LIMIT ?`,
    );
    const records: StoredRecord[] = [];
    let bytes = 0;
    let from = cursor;
    // Fetch in small chunks so a page of huge records never loads limit * maxRecordBytes at once.
    while (records.length < limit) {
      const rows = stmt.all(userId, from, Math.min(64, limit - records.length)) as unknown as RecordRow[];
      if (rows.length === 0) return { records, more: false, head };
      for (const row of rows) {
        if (records.length > 0 && bytes + row.payload.length > maxBytes) return { records, more: true, head };
        records.push(toStored(row));
        bytes += row.payload.length;
        from = row.version;
      }
      if (bytes >= maxBytes) break;
    }
    const next = this.db.prepare("SELECT 1 AS x FROM records WHERE user_id = ? AND version > ? LIMIT 1").get(userId, from);
    return { records, more: next !== undefined, head };
  }

  async resetUser(userId: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM records WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM user_seq WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM batches WHERE user_id = ?").run(userId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
