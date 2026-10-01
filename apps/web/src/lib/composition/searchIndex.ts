import fs from "node:fs";
import path from "node:path";
import { Meilisearch, type EnqueuedTaskPromise } from "meilisearch";
import * as frontmatter from "./frontmatter";
import type { Note } from "./notesRepo";
import { listNotes } from "./notesRepo";
import { DEFAULT_APP_DATA_DIR } from "./paths";
import { parseSearchQuery } from "./searchQuery";

/**
 * Mirrors apps/cli/src/composition/search.py: same uid, same document shape,
 * same settings, plus `description` so it can be searched with `description:`.
 * (The CLI and web app keep separate indexes, so this doesn't have to match
 * byte for byte.) SQLite stays the source of truth; this index is derived and
 * can be rebuilt at any time.
 */
const INDEX_UID = "notes";
const DEFAULT_MEILI_URL = "http://127.0.0.1:7700";
// A filter-only query ("tags: x") should list every match, not just a first page.
const SEARCH_LIMIT = 50;

/**
 * Set by a host that manages its own Meilisearch (the desktop app starts one on
 * a random port with a generated key), taking precedence over the environment.
 */
let configured: { host: string; apiKey?: string } | null = null;
/** Why search can't work at all (e.g. no Meilisearch binary), shown instead of the generic hint. */
let unavailableReason: string | null = null;
/** Whether this process has rebuilt the index from SQLite, so it can't hold stale documents. */
let synced = false;

function masterKey(): string | undefined {
  if (configured) return configured.apiKey;
  if (process.env.MEILI_MASTER_KEY) return process.env.MEILI_MASTER_KEY;
  try {
    return fs
      .readFileSync(path.join(DEFAULT_APP_DATA_DIR, "meili_master_key"), "utf-8")
      .trim();
  } catch {
    return undefined;
  }
}

let client: Meilisearch | null = null;
let indexReady: Promise<void> | null = null;

export function meiliHost(): string {
  return configured?.host ?? (process.env.MEILI_URL || DEFAULT_MEILI_URL);
}

/** Points search at a specific server, dropping any connection made to a previous one. */
export function configureSearch(config: { host: string; apiKey?: string }): void {
  configured = config;
  unavailableReason = null;
  client = null;
  indexReady = null;
  synced = false;
}

/** Marks search as unusable, with a message for the UI. `configureSearch` clears it. */
export function disableSearch(reason: string): void {
  configured = null;
  unavailableReason = reason;
  client = null;
  indexReady = null;
  synced = false;
}

export function unavailableMessage(): string {
  return unavailableReason ?? `Search is unavailable. Is Meilisearch running at ${meiliHost()}?`;
}

function getClient(): Meilisearch {
  client ??= new Meilisearch({ host: meiliHost(), apiKey: masterKey() });
  return client;
}

async function waitFor(task: EnqueuedTaskPromise): Promise<void> {
  const done = await task.waitTask();
  if (done.status !== "succeeded") {
    throw new Error(`Meilisearch task failed: ${done.error?.message ?? done.status}`);
  }
}

function toTimestamp(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function noteToDocument(note: Note) {
  return {
    id: note.id,
    title: note.title,
    description: note.description,
    content: note.content,
    tags: frontmatter.tagsFromString(note.tags),
    created_at_ts: toTimestamp(note.createdAt),
    updated_at_ts: toTimestamp(note.updatedAt),
  };
}

/** Idempotent; a failed attempt is dropped so the next call retries. */
function ensureIndex(): Promise<void> {
  indexReady ??= (async () => {
    const meili = getClient();
    try {
      await meili.getIndex(INDEX_UID);
    } catch {
      await waitFor(meili.createIndex(INDEX_UID, { primaryKey: "id" }));
    }
    await waitFor(
      meili.index(INDEX_UID).updateSettings({
        searchableAttributes: ["title", "content", "description"],
        filterableAttributes: ["tags", "created_at_ts", "updated_at_ts"],
        sortableAttributes: ["updated_at_ts"],
      }),
    );
  })().catch((error) => {
    indexReady = null;
    throw error;
  });
  return indexReady;
}

export async function indexNote(note: Note): Promise<void> {
  await ensureIndex();
  await getClient().index(INDEX_UID).addDocuments([noteToDocument(note)]);
}

export async function deleteNoteFromIndex(id: number): Promise<void> {
  await ensureIndex();
  await getClient().index(INDEX_UID).deleteDocument(id);
}

export async function reindexAll(notes: Note[]): Promise<void> {
  await ensureIndex();
  const index = getClient().index(INDEX_UID);
  await waitFor(index.deleteAllDocuments());
  if (notes.length > 0) {
    await waitFor(index.addDocuments(notes.map(noteToDocument)));
  }
  synced = true;
}

/**
 * Ordered, de-duplicated note ids matching `query`, which may mix free text with
 * `field: value` filters (see searchQuery.ts). A query with neither text nor
 * filters -> no hits.
 */
export async function searchNoteIds(query: string): Promise<number[]> {
  const parsed = parseSearchQuery(query);
  if (parsed.text === "" && parsed.filters.length === 0) return [];
  if (unavailableReason) throw new Error(unavailableReason);

  await ensureIndex();
  const index = getClient().index(INDEX_UID);

  // The CLI reindexes at startup, but a Meilisearch that was started fresh (or
  // wiped) has nothing in it, and one that predates a document-shape change has
  // documents without the new fields. Rebuild once per process from SQLite
  // rather than showing stale or empty results.
  if (!synced) {
    const notes = listNotes();
    if (notes.length > 0) await reindexAll(notes);
    synced = true;
  }

  const result = await index.search(parsed.text, {
    limit: SEARCH_LIMIT,
    filter: parsed.filters.length > 0 ? parsed.filters.join(" AND ") : undefined,
    attributesToSearchOn: parsed.attributesToSearchOn,
    // Without text there is no relevance to rank by; show the newest notes first.
    sort: parsed.text === "" ? ["updated_at_ts:desc"] : undefined,
  });
  return [...new Set(result.hits.map((hit) => Number(hit.id)))];
}
