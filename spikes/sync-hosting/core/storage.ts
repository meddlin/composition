// The narrow storage interface behind the Node core ("append a batch, pull since a cursor, look up a batch").
// The lean setup implements it with SQLite and the Postgres candidate with pg. Convex has its own
// implementation of the same operations (see ../convex/functions/sync.ts) and is held to the same contract.

import type { ParsedChange, PushResult, StoredRecord } from "../protocol/types.ts";

export interface PullPage {
  records: StoredRecord[];
  /** True when more records follow the last one returned (the page hit a record or byte cap). */
  more: boolean;
  /** The user's head as read before the records, so cursor math is safe without a shared snapshot. */
  head: number;
}

export interface SyncStorage {
  /** Create tables and the epoch if they do not exist. */
  init(): Promise<void>;

  /** Random id that changes whenever history is restored or rebuilt. */
  epoch(): Promise<string>;
  rotateEpoch(): Promise<string>;

  head(userId: string): Promise<number>;

  /**
   * One transaction, serialized per user: replay the stored result if `batchId` was seen, otherwise check each
   * change's baseVersion, assign the next consecutive versions to the accepted ones, store the result under
   * `batchId`, and commit. A version is never consumed by a rolled-back transaction, so versions are gap-free.
   */
  applyBatch(userId: string, batchId: string, changes: ParsedChange[]): Promise<PushResult & { replayed: boolean }>;

  /** Records with version > cursor in ascending order, up to `limit` records or `maxBytes` payload bytes. */
  pull(userId: string, cursor: number, limit: number, maxBytes: number): Promise<PullPage>;

  /**
   * Optional: look up a device token the storage itself holds (the lean server keeps hashed tokens in its database, so
   * they are backed up and restored with the data). Absent on storages that rely on the environment's static tokens.
   */
  authenticate?(token: string): Promise<{ user: string; device: string } | null>;

  /** Dev only: delete one user's records, counter and retry records. */
  resetUser(userId: string): Promise<void>;

  close(): Promise<void>;
}

export function newEpoch(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Retry records older than this are deleted. */
export const BATCH_RETENTION_MS = 24 * 60 * 60 * 1000;
