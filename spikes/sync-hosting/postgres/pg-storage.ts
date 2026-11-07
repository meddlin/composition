// Postgres adapter: the same storage interface as the lean SQLite one, so the same contract suite and the
// same Node core run on managed Postgres (Neon). Version order is guaranteed differently here: a push locks
// the user's `user_seq` row, so one user's pushes serialize and versions commit in order (design: "Why a
// counter row and not a Postgres sequence"). Round trips per push: BEGIN, lock+read head, batch lookup,
// existing records, upsert, update-head+store-batch, COMMIT.

import pg from "pg";
import { BATCH_RETENTION_MS, newEpoch, type PullPage, type SyncStorage } from "../core/storage.ts";
import { encodeBase64 } from "../protocol/b64.ts";
import type { Applied, Conflict, ParsedChange, PushResult, StoredRecord } from "../protocol/types.ts";

interface RecordRow {
  entity: string;
  uuid: string;
  version: number;
  deleted: boolean;
  schema_version: number;
  payload: Buffer;
}

const toStored = (r: RecordRow): StoredRecord => ({
  entity: r.entity,
  uuid: r.uuid,
  version: r.version,
  deleted: r.deleted,
  schemaVersion: r.schema_version,
  payload: new Uint8Array(r.payload.buffer, r.payload.byteOffset, r.payload.byteLength),
});

export class PgStorage implements SyncStorage {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, max = 5) {
    this.pool = new pg.Pool({
      connectionString,
      max,
      // Neon sleeps after 5 idle minutes: the first connection after that waits for the wake-up, so allow it.
      connectionTimeoutMillis: 30_000,
      query_timeout: 30_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    });
    // An idle connection dropped by the server (a Neon suspend, a restart) must not crash the process.
    this.pool.on("error", (err) => console.log(JSON.stringify({ ev: "pg-pool-error", message: err.message })));
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_seq (user_id TEXT PRIMARY KEY, head INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS records (
        user_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        uuid TEXT NOT NULL,
        version INTEGER NOT NULL,
        deleted BOOLEAN NOT NULL,
        schema_version INTEGER NOT NULL,
        payload BYTEA NOT NULL,
        size INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, entity, uuid)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS records_by_version ON records (user_id, version);
      CREATE TABLE IF NOT EXISTS batches (
        user_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        response JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, batch_id)
      );
    `);
    await this.pool.query("INSERT INTO meta (key, value) VALUES ('epoch', $1) ON CONFLICT (key) DO NOTHING", [newEpoch()]);
    await this.pool.query("DELETE FROM batches WHERE created_at < now() - ($1 || ' milliseconds')::interval", [String(BATCH_RETENTION_MS)]);
  }

  async epoch(): Promise<string> {
    const { rows } = await this.pool.query<{ value: string }>("SELECT value FROM meta WHERE key = 'epoch'");
    if (!rows[0]) throw new Error("epoch missing");
    return rows[0].value;
  }

  async rotateEpoch(): Promise<string> {
    const epoch = newEpoch();
    await this.pool.query("INSERT INTO meta (key, value) VALUES ('epoch', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [epoch]);
    return epoch;
  }

  async head(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ head: number }>("SELECT head FROM user_seq WHERE user_id = $1", [userId]);
    return rows[0]?.head ?? 0;
  }

  async applyBatch(userId: string, batchId: string, changes: ParsedChange[]): Promise<PushResult & { replayed: boolean }> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN");
      // The no-op upsert takes the row lock that serializes this user's pushes, and returns the head.
      const seq = await client.query<{ head: number }>(
        "INSERT INTO user_seq (user_id, head) VALUES ($1, 0) ON CONFLICT (user_id) DO UPDATE SET head = user_seq.head RETURNING head",
        [userId],
      );
      let head = seq.rows[0]!.head;

      const prior = await client.query<{ response: PushResult }>("SELECT response FROM batches WHERE user_id = $1 AND batch_id = $2", [
        userId,
        batchId,
      ]);
      if (prior.rows[0]) {
        await client.query("COMMIT");
        return { ...prior.rows[0].response, replayed: true };
      }

      const existing = new Map<string, RecordRow>();
      if (changes.length > 0) {
        const { rows } = await client.query<RecordRow>(
          `SELECT entity, uuid, version, deleted, schema_version, payload FROM records
           WHERE user_id = $1 AND (entity, uuid) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
          [userId, changes.map((c) => c.entity), changes.map((c) => c.uuid)],
        );
        for (const r of rows) existing.set(`${r.entity}/${r.uuid}`, r);
      }

      const applied: Applied[] = [];
      const conflicts: Conflict[] = [];
      const params: unknown[] = [userId];
      const tuples: string[] = [];
      for (const change of changes) {
        const current = existing.get(`${change.entity}/${change.uuid}`);
        if (change.baseVersion !== (current?.version ?? 0)) {
          conflicts.push({
            entity: change.entity,
            uuid: change.uuid,
            current: current ? { ...toStored(current), payload: encodeBase64(toStored(current).payload) } : null,
          });
          continue;
        }
        head += 1;
        applied.push({ entity: change.entity, uuid: change.uuid, version: head });
        const p = params.length;
        params.push(change.entity, change.uuid, head, change.deleted, change.schemaVersion, Buffer.from(change.payload), change.payload.length);
        tuples.push(`($1, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7})`);
      }

      if (tuples.length > 0) {
        await client.query(
          `INSERT INTO records (user_id, entity, uuid, version, deleted, schema_version, payload, size) VALUES ${tuples.join(", ")}
           ON CONFLICT (user_id, entity, uuid) DO UPDATE SET
             version = excluded.version, deleted = excluded.deleted, schema_version = excluded.schema_version,
             payload = excluded.payload, size = excluded.size, updated_at = now()`,
          params,
        );
      }
      const result: PushResult = { applied, conflicts, head };
      await client.query(
        `WITH bump AS (UPDATE user_seq SET head = $2 WHERE user_id = $1 AND head < $2)
         INSERT INTO batches (user_id, batch_id, response) VALUES ($1, $3, $4)`,
        [userId, head, batchId, JSON.stringify(result)],
      );
      await client.query("COMMIT");
      return { ...result, replayed: false };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true; // the connection is gone; do not return it to the pool
      }
      throw err;
    } finally {
      client.release(broken || undefined);
    }
  }

  async pull(userId: string, cursor: number, limit: number, maxBytes: number): Promise<PullPage> {
    const head = await this.head(userId);
    // One query: take up to limit+1 rows, keep the prefix whose running payload size stays within the byte cap
    // (always at least one row), and report how many were fetched so we can tell whether more follow.
    const { rows } = await this.pool.query<RecordRow & { fetched: string }>(
      `SELECT entity, uuid, version, deleted, schema_version, payload, fetched FROM (
         SELECT lim.*, SUM(size) OVER (ORDER BY version) AS running, ROW_NUMBER() OVER (ORDER BY version) AS n
         FROM (SELECT *, COUNT(*) OVER () AS fetched FROM records WHERE user_id = $1 AND version > $2 ORDER BY version LIMIT $3) lim
       ) t WHERE n = 1 OR running <= $4 ORDER BY version`,
      [userId, cursor, limit + 1, maxBytes],
    );
    const fetched = rows[0] ? Number(rows[0].fetched) : 0;
    const kept = rows.slice(0, limit);
    return { records: kept.map(toStored), more: fetched > kept.length, head };
  }

  async resetUser(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM records WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM user_seq WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM batches WHERE user_id = $1", [userId]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
