import fs from "node:fs";
import path from "node:path";
import { Meilisearch, type EnqueuedTaskPromise } from "meilisearch";
import * as frontmatter from "./frontmatter";
import type { Note } from "./notesRepo";
import { listNotes } from "./notesRepo";
import { DEFAULT_APP_DATA_DIR } from "./paths";

/**
 * Mirrors apps/cli/src/composition/search.py so the CLI and web app share one
 * index: same uid, same document shape, same settings. SQLite stays the source
 * of truth; this index is derived and can be rebuilt at any time.
 */
const INDEX_UID = "notes";
const DEFAULT_MEILI_URL = "http://127.0.0.1:7700";
const SEARCH_LIMIT = 20;

function masterKey(): string | undefined {
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
  return process.env.MEILI_URL || DEFAULT_MEILI_URL;
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
        searchableAttributes: ["title", "content"],
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
}

/** Ordered, de-duplicated note ids matching `query`. Empty query -> no hits. */
export async function searchNoteIds(query: string): Promise<number[]> {
  const text = query.trim();
  if (text === "") return [];

  await ensureIndex();
  const index = getClient().index(INDEX_UID);

  // The CLI reindexes at startup, but a Meilisearch that was started fresh (or
  // wiped) has nothing in it. Rebuild once from SQLite rather than showing an
  // empty result for every query.
  const { numberOfDocuments } = await index.getStats();
  if (numberOfDocuments === 0) {
    const notes = listNotes();
    if (notes.length > 0) await reindexAll(notes);
  }

  const result = await index.search(text, { limit: SEARCH_LIMIT });
  return [...new Set(result.hits.map((hit) => Number(hit.id)))];
}
