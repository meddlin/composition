import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_BYTES } from "./documentNames";

vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "unavailable",
}));

let home: string;
let source: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-documents-"));
  source = path.join(home, "inbox");
  fs.mkdirSync(source);
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const appData = () => path.join(home, ".composition");
const PDF = (extra = "") => Buffer.from(`%PDF-1.7\n${extra}\n%%EOF\n`);

const write = (name: string, content: string | Buffer = PDF()) => {
  const file = path.join(source, name);
  fs.writeFileSync(file, content);
  return file;
};

const storedFiles = () => {
  const dir = path.join(appData(), "documents");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

async function setup() {
  const service = await import("./service");
  const documents = await import("./documents");
  const repo = await import("./documentsRepo");
  const marks = await import("./pdfMarkupRepo");
  const note = await service.createNote("Textbook");
  return { service, documents, repo, marks, note };
}

describe("importDocument", () => {
  it("copies the PDF into the application data directory and gives it to the note", async () => {
    const { documents, note } = await setup();
    const bytes = PDF("one");

    const result = await documents.importDocument(appData(), note.id, write("Designing Data.pdf", bytes), { pageCount: 12 });

    expect(result.status).toBe("added");
    if (result.status !== "added") return;
    expect(result.document).toEqual(
      expect.objectContaining({
        noteId: note.id,
        fileName: "Designing Data.pdf",
        size: bytes.length,
        pageCount: 12,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        viewState: {},
      }),
    );
    expect(result.document.uuid).toMatch(/^[0-9a-f]{32}$/);
    expect(storedFiles()).toEqual([result.document.storedName]);
    expect(result.document.storedName).toMatch(/^[0-9a-f]{12}-Designing_Data\.pdf$/);
    expect(fs.readFileSync(path.join(appData(), "documents", result.document.storedName))).toEqual(bytes);
  });

  it("leaves the original where it was", async () => {
    const { documents, note } = await setup();
    const file = write("keep.pdf");

    await documents.importDocument(appData(), note.id, file);

    expect(fs.existsSync(file)).toBe(true);
  });

  it("does not know the page count until the reader has counted them", async () => {
    const { documents, repo, note } = await setup();

    const result = await documents.importDocument(appData(), note.id, write("a.pdf"));
    expect(result.status === "added" && result.document.pageCount).toBe(0);
    if (result.status !== "added") return;

    repo.setPageCount(result.document.id, 41);

    expect(repo.getDocument(result.document.id)?.pageCount).toBe(41);
    expect(() => repo.setPageCount(result.document.id, 0)).toThrow(RangeError);
  });

  it("accepts a PDF with a little junk before the header, as pdf.js does", async () => {
    const { documents, note } = await setup();

    const result = await documents.importDocument(appData(), note.id, write("junk.pdf", Buffer.concat([Buffer.alloc(900, 0x20), PDF()])));

    expect(result.status).toBe("added");
  });

  it("refuses a file that is not a PDF, and leaves nothing behind", async () => {
    const { documents, note } = await setup();
    const files = [
      write("notes.txt", "just text"),
      write("zipped.pdf", Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3])),
      write("empty.pdf", ""),
      write("late.pdf", Buffer.concat([Buffer.alloc(1100, 0x20), PDF()])),
    ];

    for (const file of files) {
      const result = await documents.importDocument(appData(), note.id, file);
      expect(result, path.basename(file)).toEqual({ status: "refused", error: `${path.basename(file)}: this doesn't look like a PDF.` });
    }
    expect(storedFiles()).toEqual([]);
  });

  it("refuses a folder, by name", async () => {
    const { documents, note } = await setup();
    const folder = path.join(source, "chapters.pdf");
    fs.mkdirSync(folder);

    expect(await documents.importDocument(appData(), note.id, folder)).toEqual({
      status: "refused",
      error: "chapters.pdf: only files can be imported, not folders.",
    });
  });

  it("refuses a file over the size limit and leaves nothing behind", async () => {
    const { documents, note } = await setup();
    const big = write("big.pdf", "");
    fs.truncateSync(big, MAX_DOCUMENT_BYTES + 1); // sparse, so no real disk is used

    expect(await documents.importDocument(appData(), note.id, big)).toEqual({
      status: "refused",
      error: "big.pdf: files can be at most 1 GB.",
    });
    expect(storedFiles()).toEqual([]);
  });

  it("reports a missing file without throwing", async () => {
    const { documents, note } = await setup();

    expect(await documents.importDocument(appData(), note.id, path.join(source, "gone.pdf"))).toEqual({
      status: "refused",
      error: "gone.pdf: could not be read.",
    });
  });

  it("refuses a note that already has a PDF, and a note that no longer exists", async () => {
    const { documents, note } = await setup();
    await documents.importDocument(appData(), note.id, write("first.pdf", PDF("1")));

    expect(await documents.importDocument(appData(), note.id, write("second.pdf", PDF("2")))).toEqual({
      status: "refused",
      error: "That note already has a PDF.",
    });
    expect(await documents.importDocument(appData(), 9999, write("third.pdf", PDF("3")))).toEqual({
      status: "refused",
      error: "That note no longer exists.",
    });
    expect(storedFiles()).toHaveLength(1);
  });

  it("offers the PDF you already have when the same bytes come in again, copying nothing", async () => {
    const { service, documents, note } = await setup();
    const other = await service.createNote("Second reading");
    const first = await documents.importDocument(appData(), note.id, write("book.pdf"));
    if (first.status !== "added") throw new Error("expected the first import to be added");

    const again = await documents.importDocument(appData(), other.id, write("book copy.pdf"));

    expect(again).toEqual({ status: "duplicate", existing: [first.document] });
    expect(storedFiles()).toEqual([first.document.storedName]);
    expect(fs.readdirSync(path.join(appData(), "documents")).filter((n) => n.startsWith("."))).toEqual([]);
  });

  it("imports a separate copy of the same bytes when asked, and lists both afterwards", async () => {
    const { service, documents, repo, note } = await setup();
    const other = await service.createNote("Second reading");
    await documents.importDocument(appData(), note.id, write("book.pdf"));

    const copy = await documents.importDocument(appData(), other.id, write("book copy.pdf"), { allowDuplicate: true });

    expect(copy.status).toBe("added");
    expect(storedFiles()).toHaveLength(2);
    if (copy.status !== "added") return;
    expect(repo.findDocumentsBySha256(copy.document.sha256).map((d) => d.noteId)).toEqual([note.id, other.id]);
  });
});

describe("documentPath", () => {
  it("is the stored file, and null for an unknown id or a file deleted behind the app's back", async () => {
    const { documents, note } = await setup();
    const result = await documents.importDocument(appData(), note.id, write("a.pdf"));
    if (result.status !== "added") throw new Error("expected an added PDF");

    expect(documents.documentPath(appData(), result.document.id)).toEqual({
      path: path.join(appData(), "documents", result.document.storedName),
      document: result.document,
    });
    expect(documents.documentPath(appData(), 9999)).toBeNull();

    fs.rmSync(path.join(appData(), "documents", result.document.storedName));
    expect(documents.documentPath(appData(), result.document.id)).toBeNull();
  });
});

describe("removeDocument", () => {
  it("deletes the row, the marks, the bookmarks and the file, and only that PDF's", async () => {
    const { service, documents, marks, note } = await setup();
    const other = await service.createNote("Other");
    const mine = await documents.importDocument(appData(), note.id, write("mine.pdf", PDF("mine")));
    const theirs = await documents.importDocument(appData(), other.id, write("theirs.pdf", PDF("theirs")));
    if (mine.status !== "added" || theirs.status !== "added") throw new Error("expected both to be added");
    for (const { document } of [mine, theirs]) {
      marks.addAnnotation(document.id, { page: 0, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]] });
      marks.addBookmark(document.id, 0, "start");
    }

    expect(await documents.removeDocument(appData(), mine.document.id)).toBe(true);

    expect(marks.listAnnotations(mine.document.id)).toEqual([]);
    expect(marks.listBookmarks(mine.document.id)).toEqual([]);
    expect(marks.listAnnotations(theirs.document.id)).toHaveLength(1);
    expect(marks.listBookmarks(theirs.document.id)).toHaveLength(1);
    expect(storedFiles()).toEqual([theirs.document.storedName]);
  });

  it("says so when there is nothing to remove", async () => {
    const { documents } = await setup();

    expect(await documents.removeDocument(appData(), 9999)).toBe(false);
  });
});

describe("a note's PDF through the Trash Can", () => {
  async function noteWithPdf() {
    const ctx = await setup();
    const other = await ctx.service.createNote("Other");
    const mine = await ctx.documents.importDocument(appData(), ctx.note.id, write("mine.pdf", PDF("mine")), { pageCount: 5 });
    const theirs = await ctx.documents.importDocument(appData(), other.id, write("theirs.pdf", PDF("theirs")), { pageCount: 5 });
    if (mine.status !== "added" || theirs.status !== "added") throw new Error("expected both to be added");
    ctx.marks.addAnnotation(mine.document.id, { page: 2, kind: "highlight", color: "green", rects: [[0, 0, 9, 9]], quote: "kept" });
    ctx.marks.addBookmark(mine.document.id, 3, "later");
    return { ...ctx, other, mine: mine.document, theirs: theirs.document };
  }

  it("keeps the file and the markup while the note is in the Trash Can", async () => {
    const { service, repo, marks, note, mine } = await noteWithPdf();

    await service.deleteNote(note.id);

    expect(repo.getDocumentForNote(note.id)?.id).toBe(mine.id);
    expect(marks.listAnnotations(mine.id)).toHaveLength(1);
    expect(marks.listBookmarks(mine.id)).toHaveLength(1);
    expect(storedFiles()).toHaveLength(2);
  });

  it("finds them again when the note is restored", async () => {
    const { service, repo, marks, note, mine } = await noteWithPdf();
    await service.deleteNote(note.id);

    await service.restoreNote(note.id);

    expect(repo.getDocumentForNote(note.id)).toEqual(mine);
    expect(marks.listAnnotations(mine.id).map((a) => a.quote)).toEqual(["kept"]);
    expect(storedFiles()).toHaveLength(2);
  });

  it("deletes the file, the marks and the bookmarks, and only them, when the note is permanently deleted", async () => {
    const { service, repo, marks, note, mine, theirs } = await noteWithPdf();
    await service.deleteNote(note.id);

    await service.permanentlyDeleteNote(note.id);

    expect(repo.getDocument(mine.id)).toBeNull();
    expect(marks.listAnnotations(mine.id)).toEqual([]);
    expect(marks.listBookmarks(mine.id)).toEqual([]);
    expect(storedFiles()).toEqual([theirs.storedName]);
    expect(repo.getDocument(theirs.id)).not.toBeNull();
  });

  it("deletes them when the note outlives the Trash Can's retention window, and keeps one still inside it", async () => {
    const { service, repo, note, other, mine, theirs } = await noteWithPdf();
    await service.deleteNote(note.id);
    await service.deleteNote(other.id);
    const { getDb } = await import("./db");
    getDb().prepare("UPDATE trashed_notes SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(note.id);

    await service.loadTrash();

    expect(repo.getDocument(mine.id)).toBeNull();
    expect(repo.getDocument(theirs.id)).not.toBeNull();
    expect(storedFiles()).toEqual([theirs.storedName]);
  });

  it("leaves a live note's PDF alone when the trash is cleaned", async () => {
    const { service, repo, note, mine } = await noteWithPdf();

    await service.loadTrash();
    await service.loadWorkspace();

    expect(repo.getDocument(mine.id)).not.toBeNull();
    expect(storedFiles()).toHaveLength(2);
    expect(note.id).toBe(mine.noteId);
  });

  it("sweeps the PDF of a note deleted for good behind the app's back, as the CLI does", async () => {
    const { documents, repo, marks, note, mine, theirs } = await noteWithPdf();
    const { getDb } = await import("./db");
    getDb().prepare("DELETE FROM notes WHERE id = ?").run(note.id);

    await documents.removeOrphans(appData());

    expect(repo.getDocument(mine.id)).toBeNull();
    expect(marks.listAnnotations(mine.id)).toEqual([]);
    expect(storedFiles()).toEqual([theirs.storedName]);
  });

  it("also sweeps marks and bookmarks whose PDF row is already gone", async () => {
    const { documents, marks, mine } = await noteWithPdf();
    const { getDb } = await import("./db");
    getDb().prepare("DELETE FROM documents WHERE id = ?").run(mine.id);

    await documents.removeOrphans(appData());

    expect(marks.listAnnotations(mine.id)).toEqual([]);
    expect(marks.listBookmarks(mine.id)).toEqual([]);
  });
});
