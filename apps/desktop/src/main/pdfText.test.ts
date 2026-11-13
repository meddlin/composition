import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { PdfTextOutcome } from "../../../web/src/lib/composition/pdfText";
import type { PdfTextSource, PdfTextState } from "../../../web/src/lib/composition/searchIndex";
import { readJob } from "../worker/pdfTextWorker";
import { pdfjsAssets, pdfTextWorkerPath, PdfTextIndexer, readInChild, type PdfTextChild, type PdfTextDeps } from "./pdfText";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.resolve(here, "../../../../fixtures/conformance");

/** A stand-in utility process that answers (or ends) as told. */
function child(answer: (job: unknown) => unknown | "exit"): PdfTextChild & { jobs: unknown[]; killed: boolean } {
  const events = new EventEmitter();
  const made = {
    jobs: [] as unknown[],
    killed: false,
    postMessage(message: unknown) {
      made.jobs.push(message);
      const reply = answer(message);
      queueMicrotask(() => (reply === "exit" ? events.emit("exit", 9) : events.emit("message", reply)));
    },
    kill() {
      made.killed = true;
      return true;
    },
    once(event: string, listener: Parameters<EventEmitter["once"]>[1]) {
      events.once(event, listener);
      if (event === "spawn") queueMicrotask(() => events.emit("spawn"));
      return made;
    },
  };
  return made as PdfTextChild & { jobs: unknown[]; killed: boolean };
}

const job = { path: "/library/documents/a.pdf", cMapUrl: "/c/", standardFontDataUrl: "/f/" };

describe("readInChild", () => {
  it("sends the job, answers with what came back and ends the process", async () => {
    const outcome: PdfTextOutcome = { status: "pages", pages: [{ page: 0, label: null, text: "words" }] };
    const process = child(() => outcome);
    expect(await readInChild(() => process, job)).toEqual(outcome);
    expect(process.jobs).toEqual([job]);
    expect(process.killed).toBe(true);
  });

  it("is null, and the process is ended, when it takes longer than the time limit", async () => {
    const silent = child(() => new Promise(() => {}));
    silent.postMessage = (message: unknown) => void silent.jobs.push(message);
    expect(await readInChild(() => silent, job, 20)).toBeNull();
    expect(silent.killed).toBe(true);
  });

  it("is null when the process ends without answering or cannot start, so nothing is recorded", async () => {
    expect(await readInChild(() => child(() => "exit"), job)).toBeNull();
    expect(
      await readInChild(() => {
        throw new Error("no fork");
      }, job),
    ).toBeNull();
  });
});

describe("the worker", () => {
  it("reads the conformance fixture from its path as the committed oracle has it", async () => {
    const assets = pdfjsAssets(path.resolve(here, "..", "..", "dist"), () => false);
    const outcome = await readJob({ path: path.join(corpus, "pdf-text.pdf"), ...assets });
    const expected = JSON.parse(fs.readFileSync(path.join(corpus, "pdf-text.json"), "utf-8")) as { pages: { page: number; text: string }[] };
    expect(outcome.status).toBe("pages");
    if (outcome.status === "pages") expect(outcome.pages.map(({ page, text }) => ({ page, text }))).toEqual(expected.pages.map(({ page, text }) => ({ page, text })));
  });

  it("says a file that is missing or is not a PDF is unreadable", async () => {
    const assets = pdfjsAssets(path.resolve(here, "..", "..", "dist"), () => false);
    expect(await readJob({ path: path.join(corpus, "no-such.pdf"), ...assets })).toEqual({ status: "unreadable" });
    expect(await readJob({ path: path.join(corpus, "pdf-text.json"), ...assets })).toEqual({ status: "unreadable" });
  });
});

describe("where the worker and pdf.js's assets are", () => {
  it("uses the unpacked worker when packaged", () => {
    const packaged = path.join("/App", "Resources", "app.asar", "dist");
    expect(pdfTextWorkerPath(packaged, () => true)).toBe(path.join("/App", "Resources", "app.asar.unpacked", "dist", "pdf-text-worker.js"));
    expect(pdfTextWorkerPath("/repo/apps/desktop/dist", () => true)).toBe(path.join("/repo/apps/desktop/dist", "pdf-text-worker.js"));
  });

  it("uses the renderer's copy of pdf.js's assets when it is built, else the package", () => {
    const sep = path.sep;
    expect(pdfjsAssets("/d/dist", () => true).cMapUrl).toBe(`${path.join("/d/dist", "renderer", "pdfjs", "cmaps")}${sep}`);
    expect(pdfjsAssets("/repo/apps/desktop/dist", () => false).standardFontDataUrl).toBe(
      `${path.join("/repo/apps/web/node_modules/pdfjs-dist", "standard_fonts")}${sep}`,
    );
  });
});

/** An index that keeps what it is told, and a library of PDFs. */
function world(files: (PdfTextSource & { path: string })[], read: PdfTextDeps["read"]) {
  const states = new Map<number, PdfTextState>();
  const stored = new Map<number, { page: number; label: string | null; text: string }[]>();
  let disabled = false;
  const deps: PdfTextDeps = {
    sources: () => files,
    search: {
      searchIsDisabled: () => disabled,
      reconcilePdfText: async (sources) => sources.filter((s) => !states.has(s.documentId)),
      storePdfText: async (source, pages) => {
        stored.set(source.documentId, pages);
        states.set(source.documentId, pages.some((p) => p.text !== "") ? "indexed" : "noText");
      },
      markPdfText: async (source, state) => void states.set(source.documentId, state),
      pdfTextState: async (id) => states.get(id) ?? null,
    },
    read,
    log: vi.fn(),
  };
  return { deps, states, stored, disable: () => (disabled = true) };
}

describe("PdfTextIndexer", () => {
  const files = [
    { documentId: 1, noteId: 10, sha256: "a", path: "/lib/a.pdf" },
    { documentId: 2, noteId: 20, sha256: "b", path: "/lib/b.pdf" },
    { documentId: 3, noteId: 30, sha256: "c", path: "/lib/c.pdf" },
  ];
  const answers: Record<string, PdfTextOutcome | null> = {
    "/lib/a.pdf": { status: "pages", pages: [{ page: 0, label: null, text: "lighthouse" }] },
    "/lib/b.pdf": { status: "locked" },
    "/lib/c.pdf": null,
  };

  it("reads each PDF not yet in search once, records locked ones, and leaves one whose reading failed for next time", async () => {
    const read = vi.fn(async (file: { path: string; password?: string }) => answers[file.path]);
    const { deps, states } = world(files, read);
    const indexer = new PdfTextIndexer(deps);
    await indexer.run();
    expect(states).toEqual(new Map<number, PdfTextState>([[1, "indexed"], [2, "locked"]]));
    expect(read.mock.calls.map(([file]) => file)).toEqual([{ path: "/lib/a.pdf" }, { path: "/lib/b.pdf" }, { path: "/lib/c.pdf" }]);
    await indexer.run();
    expect(read).toHaveBeenCalledTimes(4); // only the one that failed is tried again
  });

  it("reads a locked PDF with the password it was unlocked with, and only a locked one", async () => {
    const read = vi.fn(async (file: { path: string; password?: string }) =>
      file.password === "secret" ? ({ status: "pages", pages: [{ page: 0, label: null, text: "unlocked words" }] } as PdfTextOutcome) : answers[file.path],
    );
    const { deps, states, stored } = world(files, read);
    const indexer = new PdfTextIndexer(deps);
    await indexer.run();
    await indexer.readUnlocked(1, "secret");
    expect(read).not.toHaveBeenCalledWith({ path: "/lib/a.pdf", password: "secret" });
    await indexer.readUnlocked(2, "secret");
    expect(read).toHaveBeenLastCalledWith({ path: "/lib/b.pdf", password: "secret" });
    expect(states.get(2)).toBe("indexed");
    expect(stored.get(2)?.[0].text).toBe("unlocked words");
    expect(await indexer.state(2)).toBe("indexed");
  });

  it("runs one job at a time, in order, and survives a failing one", async () => {
    const order: string[] = [];
    const read = vi.fn(async (file: { path: string }) => {
      order.push(`start ${file.path}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${file.path}`);
      return answers[file.path];
    });
    const { deps } = world(files.slice(0, 1), read);
    deps.search.reconcilePdfText = vi.fn().mockRejectedValueOnce(new Error("Meilisearch is down")).mockImplementation(async (s: PdfTextSource[]) => s);
    const indexer = new PdfTextIndexer(deps);
    const first = indexer.run();
    const second = indexer.run();
    await Promise.all([first, second]);
    expect(deps.log).toHaveBeenCalledWith("[search] reading PDFs' text failed", expect.any(Error));
    expect(order).toEqual(["start /lib/a.pdf", "end /lib/a.pdf"]);
  });

  it("reads nothing and says nothing while search is not running", async () => {
    const read = vi.fn();
    const { deps, disable } = world(files, read);
    disable();
    const indexer = new PdfTextIndexer(deps);
    await indexer.run();
    expect(read).not.toHaveBeenCalled();
    expect(await indexer.state(1)).toBeNull();
  });
});
