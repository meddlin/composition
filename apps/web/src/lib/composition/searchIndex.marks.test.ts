import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for Meilisearch that keeps what it is asked to index.
const indexed: { content: string; id: number }[][] = [];
const task = () => Object.assign(Promise.resolve({}), { waitTask: async () => ({ status: "succeeded" }) });
vi.mock("meilisearch", () => ({
  Meilisearch: class {
    getIndex = async () => ({});
    createIndex = () => task();
    index() {
      return {
        updateSettings: () => task(),
        addDocuments: (docs: { content: string; id: number }[]) => {
          indexed.push(docs);
          return task();
        },
        deleteAllDocuments: () => task(),
        deleteDocument: () => task(),
      };
    }
  },
}));

let home: string;
beforeEach(() => {
  indexed.length = 0;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-searchmarks-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});
afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

async function setup() {
  const notes = await import("./notesRepo");
  const documents = await import("./documentsRepo");
  const marks = await import("./pdfMarkupRepo");
  const owner = notes.createNote("Textbook");
  const plain = notes.createNote("Plain note");
  const document = documents.addDocument({ noteId: owner.id, fileName: "book.pdf", storedName: "x-book.pdf", sha256: "a".repeat(64), size: 10, pageCount: 0 });
  marks.addAnnotation(document.id, { page: 3, kind: "highlight", color: "yellow", rects: [[0, 0, 5, 5]], quote: "B-trees keep keys sorted", comment: "exam" });
  marks.addBookmark(document.id, 3, "Indexes");
  return { notes, owner, plain, searchIndex: await import("./searchIndex") };
}

describe("indexing a note that owns a PDF", () => {
  it("adds the words of its marks and bookmarks to the content it is found by, after its own text", async () => {
    const { owner, searchIndex } = await setup();

    await searchIndex.indexNote(owner);

    const [[document]] = indexed;
    expect(document.id).toBe(owner.id);
    expect(document.content.startsWith(owner.content)).toBe(true);
    expect(document.content.endsWith("\n\nB-trees keep keys sorted\nexam\nIndexes")).toBe(true);
  });

  it("leaves a note that owns no PDF exactly as it is", async () => {
    const { plain, searchIndex } = await setup();

    await searchIndex.indexNote(plain);

    expect(indexed[0][0].content).toBe(plain.content);
  });

  it("does the same for each owner note when the whole index is rebuilt", async () => {
    const { notes, owner, plain, searchIndex } = await setup();

    await searchIndex.reindexAll(notes.listNotes());

    const documents = indexed.flat();
    expect(documents.find((d) => d.id === owner.id)?.content).toContain("B-trees keep keys sorted");
    expect(documents.find((d) => d.id === plain.id)?.content).toBe(plain.content);
  });
});
