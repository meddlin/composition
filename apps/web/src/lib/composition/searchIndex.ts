import fs from "node:fs";
import path from "node:path";
import { Meilisearch, type EnqueuedTaskPromise } from "meilisearch";
import * as frontmatter from "./frontmatter";
import type { Note } from "./notesRepo";
import { listNotes } from "./notesRepo";
import type { PdfTextState } from "./documentsApi";
import { marksSearchText } from "./pdfMarkupRepo";
import { DEFAULT_APP_DATA_DIR } from "./paths";
import { parseSearchQuery } from "./searchQuery";

/**
 * One index, "notes", with the id as primary key and the title, description, content,
 * tags and timestamps of each note. The terminal, web and desktop apps each keep their own
 * Meilisearch and index, so they don't have to match one another byte for byte. SQLite
 * stays the source of truth; this index is derived and can be rebuilt at any time.
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
let pdfIndexesReady: Promise<void> | null = null;

export function meiliHost(): string {
  return configured?.host ?? (process.env.MEILI_URL || DEFAULT_MEILI_URL);
}

/** Points search at a specific server, dropping any connection made to a previous one. */
export function configureSearch(config: { host: string; apiKey?: string }): void {
  configured = config;
  unavailableReason = null;
  client = null;
  indexReady = null;
  pdfIndexesReady = null;
  synced = false;
}

/** Marks search as unusable, with a message for the UI. `configureSearch` clears it. */
export function disableSearch(reason: string): void {
  configured = null;
  unavailableReason = reason;
  client = null;
  indexReady = null;
  pdfIndexesReady = null;
  synced = false;
}

/**
 * Whether the host app has said search is not there (it is still starting, or could not be): `disableSearch` was called and
 * `configureSearch` has not been since. Without a host app that says so (the web app), search is only tried, so this is false.
 */
export function searchIsDisabled(): boolean {
  return unavailableReason !== null;
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

/**
 * The note as the index holds it. A note that owns a PDF is also found by the words of that PDF's marks (`marks`: the quotes,
 * comments and text notes, from `marksSearchText`), which are searched with its content and never shown, since a search
 * returns ids only.
 */
function noteToDocument(note: Note, marks = "") {
  return {
    id: note.id,
    title: note.title,
    description: note.description,
    content: marks === "" ? note.content : `${note.content}\n\n${marks}`,
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
        // `id`, so that the notes a PDF's text found can be put through the query's filters and in order (`pdfTextHits`).
        filterableAttributes: ["id", "tags", "created_at_ts", "updated_at_ts"],
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
  await getClient().index(INDEX_UID).addDocuments([noteToDocument(note, marksSearchText(note.id).get(note.id))]);
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
    const marks = marksSearchText();
    await waitFor(index.addDocuments(notes.map((note) => noteToDocument(note, marks.get(note.id)))));
  }
  synced = true;
}

/** One note a search found. `pdfPage` (0-based) is set when only its PDF's own text was found, with the page's printed label if it has one. */
export type NoteSearchHit = { id: number; pdfPage?: number; pdfPageLabel?: string | null };

/**
 * Ordered, de-duplicated note ids matching `query`, which may mix free text with
 * `field: value` filters (see searchQuery.ts). A query with neither text nor
 * filters -> no hits.
 */
export async function searchNoteIds(query: string): Promise<number[]> {
  return (await searchNotesWithPdfText(query)).map((hit) => hit.id);
}

/** `searchNoteIds`, with where each note was found: a note found only by words in its PDF's own text says on which page they first are. */
export async function searchNotesWithPdfText(query: string): Promise<NoteSearchHit[]> {
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
  const hits: NoteSearchHit[] = [...new Set(result.hits.map((hit) => Number(hit.id)))].map((id) => ({ id }));
  // Then the notes whose PDF has every word on one page, which their own text did not find. A `title:` or `description:` search is
  // about those fields only.
  if (parsed.text !== "" && parsed.attributesToSearchOn === undefined && hits.length < SEARCH_LIMIT) {
    hits.push(...(await pdfTextHits(parsed.text, parsed.filters, new Set(hits.map((hit) => hit.id)), SEARCH_LIMIT - hits.length)));
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The text of PDFs (docs/architecture/search.md, "The text of a PDF"): every page of every PDF a note owns, one document a page in
// `pdf_pages` (Meilisearch ignores every word past position 65,535 of a field, and a book has hundreds of thousands), and one document
// a PDF in `pdf_files` saying what was read from which file. The iPad keeps the same in its own index file; both put a page's text
// through `pageSearchText` (pdfText.ts) and search it the same way, which fixtures/conformance/pdf-text-search.json holds them to.
// Like the notes' index, these are derived and can be rebuilt; unlike it, reading a PDF takes seconds, so `reindexAll` leaves them be.

const PDF_PAGES_UID = "pdf_pages";
const PDF_FILES_UID = "pdf_files";
/** How many pages one search of the PDFs' text may answer with: one per note (`distinct`), so this is notes, not pages. */
const PDF_CANDIDATES = 1000;

/**
 * Where a PDF's text is: `indexed`; `noText` when no page had text (a scan: OCR is not built); `locked` when it asks for a password
 * (read the next time it is unlocked in the reader, the password used for that reading only); `unreadable` when pdf.js cannot open it.
 */
export type { PdfTextState };

/** A PDF a note owns, as the index needs to know it. */
export type PdfTextSource = { documentId: number; noteId: number; sha256: string };

type PdfFileDocument = { id: number; note_id: number; sha256: string; state: PdfTextState; pages: number; characters: number };

/** Idempotent, like `ensureIndex`. */
function ensurePdfIndexes(): Promise<void> {
  pdfIndexesReady ??= (async () => {
    const meili = getClient();
    for (const uid of [PDF_PAGES_UID, PDF_FILES_UID]) {
      try {
        await meili.getIndex(uid);
      } catch {
        await waitFor(meili.createIndex(uid, { primaryKey: "id" }));
      }
    }
    await waitFor(
      meili.index(PDF_PAGES_UID).updateSettings({
        searchableAttributes: ["text"],
        filterableAttributes: ["note_id", "document_id"],
        sortableAttributes: ["page"],
        // Every word must be on the page (`matchingStrategy: "all"` below), so relevance has nothing to choose between: the first page
        // a PDF has them on is the one shown, and `distinct` keeps that one for each note.
        rankingRules: ["sort", "words", "typo", "proximity", "attribute", "exactness"],
        // A PDF's words are found as typed (the last one also as the start of a word), as on the iPad: a library of books would make
        // near spellings match nearly anything.
        typoTolerance: { enabled: false },
      }),
    );
  })().catch((error) => {
    pdfIndexesReady = null;
    throw error;
  });
  return pdfIndexesReady;
}

async function deletePdfPages(documentId: number): Promise<void> {
  await waitFor(getClient().index(PDF_PAGES_UID).deleteDocuments({ filter: `document_id = ${documentId}` }));
}

/** Keeps a PDF's pages (replacing any it had). `pages` are as `readPdfText` gives them; a PDF none of whose pages has text is `noText`. */
export async function storePdfText(source: PdfTextSource, pages: { page: number; label: string | null; text: string }[]): Promise<void> {
  await ensurePdfIndexes();
  await deletePdfPages(source.documentId);
  const withText = pages.filter((page) => page.text !== "");
  if (withText.length > 0) {
    await waitFor(
      getClient()
        .index(PDF_PAGES_UID)
        .addDocuments(
          withText.map((page) => ({
            id: `${source.documentId}-${page.page}`,
            document_id: source.documentId,
            note_id: source.noteId,
            page: page.page,
            label: page.label,
            text: page.text,
          })),
        ),
    );
  }
  const characters = withText.reduce((sum, page) => sum + page.text.length, 0);
  await putPdfFile({ id: source.documentId, note_id: source.noteId, sha256: source.sha256, state: characters > 0 ? "indexed" : "noText", pages: pages.length, characters });
}

/** Records that a PDF could not be read (`locked` or `unreadable`), with no text. */
export async function markPdfText(source: PdfTextSource, state: "locked" | "unreadable"): Promise<void> {
  await ensurePdfIndexes();
  await deletePdfPages(source.documentId);
  await putPdfFile({ id: source.documentId, note_id: source.noteId, sha256: source.sha256, state, pages: 0, characters: 0 });
}

async function putPdfFile(file: PdfFileDocument): Promise<void> {
  await waitFor(getClient().index(PDF_FILES_UID).addDocuments([file]));
}

async function pdfFiles(): Promise<PdfFileDocument[]> {
  const files: PdfFileDocument[] = [];
  const index = getClient().index<PdfFileDocument>(PDF_FILES_UID);
  for (let offset = 0; ; offset += 1000) {
    const page = await index.getDocuments({ offset, limit: 1000 });
    files.push(...page.results);
    if (page.results.length < 1000) return files;
  }
}

/** Where a PDF's text is; null when it has not been read yet. */
export async function pdfTextState(documentId: number): Promise<PdfTextState | null> {
  await ensurePdfIndexes();
  try {
    return (await getClient().index<PdfFileDocument>(PDF_FILES_UID).getDocument(documentId)).state;
  } catch {
    return null;
  }
}

/**
 * Forgets what is no longer a PDF here (its row is gone, or the file under it changed) and returns the PDFs whose text has to be read:
 * those never read. A PDF that was locked is not returned (it is read when it is unlocked); one that could not be opened is not tried
 * again until its file changes.
 */
export async function reconcilePdfText(sources: PdfTextSource[]): Promise<PdfTextSource[]> {
  await ensurePdfIndexes();
  const current = new Map(sources.map((source) => [source.documentId, source]));
  const kept = new Set<number>();
  for (const file of await pdfFiles()) {
    const source = current.get(file.id);
    if (source && source.sha256 === file.sha256 && source.noteId === file.note_id) {
      kept.add(file.id);
    } else {
      await deletePdfPages(file.id);
      await waitFor(getClient().index(PDF_FILES_UID).deleteDocument(file.id));
    }
  }
  return sources.filter((source) => !kept.has(source.documentId));
}

/**
 * The notes, not in `excluding`, whose PDF has every word of `text` on one page (the last word also as the start of a word, quoted
 * phrases as phrases), each with the first such page, most recently updated first. They go through the query's filters and must be in
 * the notes' index, which leaves out notes in the Trash Can.
 */
async function pdfTextHits(text: string, filters: string[], excluding: Set<number>, limit: number): Promise<NoteSearchHit[]> {
  await ensurePdfIndexes();
  const pages = await getClient()
    .index<{ note_id: number; page: number; label: string | null }>(PDF_PAGES_UID)
    .search(text, { limit: PDF_CANDIDATES, sort: ["page:asc"], distinct: "note_id", matchingStrategy: "all", attributesToRetrieve: ["note_id", "page", "label"] });
  const first = new Map<number, { page: number; label: string | null }>();
  for (const hit of pages.hits) {
    if (!excluding.has(hit.note_id) && !first.has(hit.note_id)) first.set(hit.note_id, { page: hit.page, label: hit.label ?? null });
  }
  if (first.size === 0) return [];
  const notes = await getClient()
    .index(INDEX_UID)
    .search("", { filter: [`id IN [${[...first.keys()].join(", ")}]`, ...filters].join(" AND "), sort: ["updated_at_ts:desc"], limit, attributesToRetrieve: ["id"] });
  return notes.hits.map((hit) => {
    const id = Number(hit.id);
    const found = first.get(id)!;
    return { id, pdfPage: found.page, pdfPageLabel: found.label };
  });
}
