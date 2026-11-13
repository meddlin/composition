import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// How search finds words in a PDF's own text, asked of a real Meilisearch through the desktop's own searchIndex.ts, over notes and PDFs
// written below. What it answers is committed as fixtures/conformance/pdf-text-search.json, with the notes, the pages and the queries, and
// the iPad's FTS5 search replays it (PdfTextSearchConformanceTests), so a word finds the same notes at the same pages on both.
//
// Needs a Meilisearch binary (COMPOSITION_MEILI_BIN, or `meilisearch` on the PATH); skipped without one. It compares with the committed
// file; `UPDATE_FIXTURES=1` rewrites it (then run the Swift side, which has to agree).

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusFile = path.resolve(here, "../../../../../fixtures/conformance/pdf-text-search.json");
const fixturePages = (JSON.parse(fs.readFileSync(path.resolve(here, "../../../../../fixtures/conformance/pdf-text.json"), "utf-8")) as { pages: { page: number; text: string }[] }).pages;
const binary = process.env.COMPOSITION_MEILI_BIN || "meilisearch";
const haveMeilisearch = spawnSync(binary, ["--version"], { stdio: "ignore" }).status === 0;

type CorpusNote = { id: number; title: string; content: string; tags: string; updatedAt: string; trashed?: boolean };
type CorpusPdf = { documentId: number; noteId: number; pages: { page: number; label: string | null; text: string }[] };

// Notes, each with its own time so that the order of PDF hits (most recently updated first) is fixed.
const notes: CorpusNote[] = [
  { id: 1, title: "Coastal birds", content: "We saw quetzals at dawn by the old wall.", tags: "birds", updatedAt: "2026-03-01T10:00:00.000Z" },
  { id: 2, title: "Search fixture", content: "", tags: "pdf", updatedAt: "2026-02-01T10:00:00.000Z" },
  { id: 3, title: "Field guide", content: "", tags: "birds,guide", updatedAt: "2026-01-15T10:00:00.000Z" },
  { id: 4, title: "Scanned letter", content: "", tags: "", updatedAt: "2025-12-01T10:00:00.000Z" },
  { id: 5, title: "Old cookbook", content: "", tags: "kitchen", updatedAt: "2026-04-01T10:00:00.000Z", trashed: true },
  { id: 6, title: "Harbour notes", content: "The harbour master spoke of tides.", tags: "sea", updatedAt: "2025-11-01T10:00:00.000Z" },
];

const pdfs: CorpusPdf[] = [
  // fixtures/conformance/pdf-text.pdf as the desktop reads it.
  { documentId: 1, noteId: 2, pages: fixturePages.map((p) => ({ page: p.page, label: null, text: p.text })) },
  // A small book with printed page labels: roman numerals before chapter 1.
  {
    documentId: 2,
    noteId: 3,
    pages: [
      { page: 0, label: "i", text: "Preface\nA guide to the birds of the coast." },
      { page: 1, label: "ii", text: "" },
      { page: 2, label: "1", text: "The lighthouse keeper counted quetzals\nalong the estuary at low tide." },
      { page: 3, label: "2", text: "Cormorants dry their wings on the harbour wall.\nextraction" },
      { page: 4, label: "3", text: "Marmalade, said the keeper, is for the lighthouse." },
    ],
  },
  // A scan: pages with no text.
  { documentId: 3, noteId: 4, pages: [{ page: 0, label: null, text: "" }, { page: 1, label: null, text: "" }] },
  // A PDF whose note is in the Trash Can: never found.
  { documentId: 4, noteId: 5, pages: [{ page: 0, label: null, text: "Marmalade and quetzals and a lighthouse." }] },
];

const queries = [
  // A word only in a PDF, and where it is first.
  "sideways", "cormorants", "marmalade", "estuary", "preface",
  // A word in a note's own text comes first, without a page; then the PDFs.
  "quetzals", "harbour", "wall",
  // The last word is also the start of a word; the others are not.
  "quetz", "lightho", "quetzal harbour", "quetzals harb",
  // Every word on one page.
  "lighthouse keeper", "lighthouse cormorants", "estuary observatory", "keeper marmalade",
  // Phrases.
  "\"lighthouse keeper\"", "\"keeper lighthouse\"", "\"tidal estuary\"",
  // No typo tolerance in a PDF's text (a note's own text keeps its own).
  "cormorents", "sidways", "quetzls",
  // The shared rule: a word broken over two lines, ligatures, accents, full-width letters, Greek and Cyrillic.
  "extraction", "office", "affidavit", "cafe", "café", "zurich", "naive", "wide", "москва", "ζευς", "ζεύς",
  // Words around punctuation.
  "beta", "version", "example", "item",
  // Filters apply to what a PDF found; a title: or description: search leaves the PDFs out.
  "quetzals tag: guide", "marmalade tag: birds", "lighthouse updated: >=2026-01-20", "title: marmalade", "description: marmalade",
  // Nothing.
  "xylophone", "quetzals xylophone",
];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** A throwaway Meilisearch, started the way the desktop starts its own (apps/desktop/src/main/meili.ts). */
async function withMeilisearch<T>(work: (server: { host: string; apiKey: string; version: string }) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-pdf-meili-"));
  const port = await freePort();
  const apiKey = crypto.randomBytes(16).toString("hex");
  const child = spawn(
    binary,
    ["--db-path", path.join(dir, "data"), "--http-addr", `127.0.0.1:${port}`, "--dump-dir", path.join(dir, "dumps"), "--snapshot-dir", path.join(dir, "snapshots"), "--no-analytics"],
    { cwd: dir, stdio: "ignore", env: { ...process.env, MEILI_MASTER_KEY: apiKey, MEILI_ENV: "production" } },
  );
  try {
    const host = `http://127.0.0.1:${port}`;
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await fetch(`${host}/health`)).ok) break;
      } catch {
        // not listening yet
      }
      if (attempt > 150) throw new Error("Meilisearch did not become healthy");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const version = ((await (await fetch(`${host}/version`, { headers: { Authorization: `Bearer ${apiKey}` } })).json()) as { pkgVersion: string }).pkgVersion;
    return await work({ host, apiKey, version });
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-pdftext-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});
afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe.skipIf(!haveMeilisearch)("searching a PDF's own text, with a real Meilisearch", () => {
  it("answers as fixtures/conformance/pdf-text-search.json says", { timeout: 120_000 }, async () => {
    const { getDb } = await import("./db");
    const notesRepo = await import("./notesRepo");
    const documentsRepo = await import("./documentsRepo");
    const trashRepo = await import("./trashRepo");
    const search = await import("./searchIndex");

    for (const note of notes) {
      const made = notesRepo.createNote(note.title, note.content);
      expect(made.id).toBe(note.id);
      getDb().prepare("UPDATE notes SET tags = ?, created_at = ?, updated_at = ? WHERE id = ?").run(note.tags, note.updatedAt, note.updatedAt, note.id);
    }
    for (const pdf of pdfs) {
      const document = documentsRepo.addDocument({ noteId: pdf.noteId, fileName: `${pdf.documentId}.pdf`, storedName: `x-${pdf.documentId}.pdf`, sha256: String(pdf.documentId).repeat(64).slice(0, 64), size: 1, pageCount: pdf.pages.length });
      expect(document.id).toBe(pdf.documentId);
    }
    for (const note of notes.filter((n) => n.trashed)) trashRepo.trashNote(note.id);

    const answers = await withMeilisearch(async (server) => {
      search.configureSearch({ host: server.host, apiKey: server.apiKey });
      await search.reindexAll(notesRepo.listNotes());
      for (const pdf of pdfs) await search.storePdfText({ documentId: pdf.documentId, noteId: pdf.noteId, sha256: "x" }, pdf.pages);
      const results: { query: string; hits: { id: number; page: number | null; label: string | null }[] }[] = [];
      for (const query of queries) {
        const hits = await search.searchNotesWithPdfText(query);
        results.push({ query, hits: hits.map((hit) => ({ id: hit.id, page: hit.pdfPage ?? null, label: hit.pdfPageLabel ?? null })) });
      }
      const states = await Promise.all(pdfs.map(async (pdf) => ({ documentId: pdf.documentId, state: await search.pdfTextState(pdf.documentId) })));
      return { meilisearch: server.version, results, states };
    });

    const corpus = {
      about:
        "How search finds words in a PDF's own text: notes, the PDFs they own (pages as pageSearchText makes them; page is 0-based), and what a real Meilisearch " +
        "answered through the desktop's searchIndex.ts for each query (page and label null when the note was found by its own text). Made by " +
        "apps/web/src/lib/composition/pdfTextSearch.test.ts (UPDATE_FIXTURES=1 rewrites it); the iPad replays it in PdfTextSearchConformanceTests.",
      meilisearch: answers.meilisearch,
      notes,
      pdfs,
      states: answers.states,
      results: answers.results,
    };
    const json = `${JSON.stringify(corpus, null, 1)}\n`;
    if (process.env.UPDATE_FIXTURES) fs.writeFileSync(corpusFile, json);
    const committed = JSON.parse(fs.readFileSync(corpusFile, "utf-8")) as typeof corpus;
    expect({ ...corpus, meilisearch: committed.meilisearch }).toEqual(committed);
  });
});
