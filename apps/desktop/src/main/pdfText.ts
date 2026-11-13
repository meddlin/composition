import fs from "node:fs";
import path from "node:path";
import type { PdfTextOutcome } from "../../../web/src/lib/composition/pdfText";
import type { PdfTextSource, PdfTextState } from "../../../web/src/lib/composition/searchIndex";

/**
 * The text of PDFs in search (docs/architecture/search.md, "The text of a PDF"): every PDF a note owns is read once, in the background,
 * and its pages go into the search index, so that a word only in the PDF finds the note. Read when search is ready (PDFs imported
 * before this was built, or after the data location changes), after an import, after a delete for good (only what is gone is
 * forgotten), and after a protected PDF is unlocked in the reader (its password is used for that one reading and never kept). One PDF
 * at a time, each in a utility process of its own (worker/pdfTextWorker.ts), so the main process never parses a PDF.
 */

/** What the worker is given. */
export type PdfTextJob = { path: string; cMapUrl: string; standardFontDataUrl: string; password?: string };

/** The process a job runs in: Electron's `utilityProcess.fork` in the app, a stand-in in tests. */
export type PdfTextChild = {
  postMessage(message: unknown): void;
  kill(): boolean;
  once(event: "spawn", listener: () => void): unknown;
  once(event: "message", listener: (message: unknown) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
};

/** How long one PDF may take to read before its process is stopped: far more than a book needs (half a second for 600 pages). */
export const READ_TIME_LIMIT_MS = 5 * 60_000;

/**
 * Runs one reading in a process of its own and says what came of it. Null when the process could not start, ended without answering
 * (out of memory, say) or took longer than `timeLimit`: then nothing is recorded, and the PDF is tried again the next time.
 */
export function readInChild(fork: () => PdfTextChild, job: PdfTextJob, timeLimit = READ_TIME_LIMIT_MS): Promise<PdfTextOutcome | null> {
  return new Promise((resolve) => {
    let child: PdfTextChild;
    try {
      child = fork();
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => finish(null), timeLimit);
    const finish = (outcome: PdfTextOutcome | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(outcome);
    };
    child.once("message", (message) => finish(message as PdfTextOutcome));
    child.once("exit", () => finish(null));
    child.once("spawn", () => child.postMessage(job));
  });
}

/** Where the worker's script is: unpacked beside the archive when packaged (`asarUnpack` in electron-builder.yml), as the export's is. */
export function pdfTextWorkerPath(directory: string, exists: (file: string) => boolean = fs.existsSync): string {
  const file = path.join(directory, "pdf-text-worker.js");
  const unpacked = file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return unpacked !== file && exists(unpacked) ? unpacked : file;
}

/**
 * Where pdf.js's CMaps and standard fonts are: the copy the renderer is built with (dist/renderer/pdfjs), or, in development before a
 * renderer build, the package itself. Each ends in a slash, as pdf.js wants.
 */
export function pdfjsAssets(directory: string, exists: (file: string) => boolean = fs.existsSync): { cMapUrl: string; standardFontDataUrl: string } {
  const built = path.join(directory, "renderer", "pdfjs");
  const root = exists(path.join(built, "cmaps")) ? built : path.resolve(directory, "..", "..", "web", "node_modules", "pdfjs-dist");
  return { cMapUrl: `${path.join(root, "cmaps")}${path.sep}`, standardFontDataUrl: `${path.join(root, "standard_fonts")}${path.sep}` };
}

/** What the indexer needs, as plain functions, so tests need neither Electron nor Meilisearch. */
export type PdfTextDeps = {
  /** Every PDF in the library, with where its file is. */
  sources(): (PdfTextSource & { path: string })[];
  search: {
    searchIsDisabled(): boolean;
    reconcilePdfText(sources: PdfTextSource[]): Promise<PdfTextSource[]>;
    storePdfText(source: PdfTextSource, pages: { page: number; label: string | null; text: string }[]): Promise<void>;
    markPdfText(source: PdfTextSource, state: "locked" | "unreadable"): Promise<void>;
    pdfTextState(documentId: number): Promise<PdfTextState | null>;
  };
  /** Reads one file (`readInChild` in the app). */
  read(file: { path: string; password?: string }): Promise<PdfTextOutcome | null>;
  log(message: string, detail?: unknown): void;
};

export class PdfTextIndexer {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PdfTextDeps) {}

  /** Reads every PDF whose text is not in search yet, after whatever is already queued. Never rejects. */
  run(): Promise<void> {
    return this.enqueue(async () => {
      const { search } = this.deps;
      const all = this.deps.sources();
      const toRead = await search.reconcilePdfText(all.map(({ documentId, noteId, sha256 }) => ({ documentId, noteId, sha256 })));
      const started = Date.now();
      let read = 0;
      for (const source of toRead) {
        const file = all.find((s) => s.documentId === source.documentId);
        if (!file || search.searchIsDisabled()) continue;
        if (await this.readOne(source, file.path)) read++;
      }
      if (read > 0) this.deps.log(`[search] read the text of ${read} PDF(s) in ${Date.now() - started} ms`);
    });
  }

  /** A protected PDF was unlocked in the reader: its text is read now with that password, if it was waiting for one. Never rejects. */
  readUnlocked(documentId: number, password: string): Promise<void> {
    return this.enqueue(async () => {
      if ((await this.deps.search.pdfTextState(documentId)) !== "locked") return;
      const file = this.deps.sources().find((s) => s.documentId === documentId);
      if (file) await this.readOne(file, file.path, password);
    });
  }

  /** Where a PDF's text is, for the reader; null while it has not been read or when search is not running. */
  async state(documentId: number): Promise<PdfTextState | null> {
    if (this.deps.search.searchIsDisabled()) return null;
    try {
      return await this.deps.search.pdfTextState(documentId);
    } catch {
      return null;
    }
  }

  private async readOne(source: PdfTextSource, file: string, password?: string): Promise<boolean> {
    const outcome = await this.deps.read({ path: file, ...(password === undefined ? {} : { password }) });
    if (!outcome) return false;
    const plain = { documentId: source.documentId, noteId: source.noteId, sha256: source.sha256 };
    if (outcome.status === "pages") await this.deps.search.storePdfText(plain, outcome.pages);
    // A wrong password for a PDF just unlocked cannot happen (the reader opened it with this one); without one, it waits for the reader.
    else await this.deps.search.markPdfText(plain, outcome.status);
    return true;
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work).catch((error: unknown) => this.deps.log("[search] reading PDFs' text failed", error));
    this.queue = next;
    return next;
  }
}
