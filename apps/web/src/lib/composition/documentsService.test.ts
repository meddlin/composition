import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeContents } from "./pdfContents";
import { pdfTitleFromFileName } from "./documentNames";

vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "unavailable",
}));

let home: string;
let source: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-docservice-"));
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
const pdf = (name: string, extra = "") => {
  const file = path.join(source, name);
  fs.writeFileSync(file, `%PDF-1.7\n${extra}\n%%EOF\n`);
  return file;
};
const storedFiles = () => {
  const dir = path.join(appData(), "documents");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

async function setup() {
  const service = await import("./service");
  const groups = await import("./groupsRepo");
  const notes = await import("./notesRepo");
  const notebooks = await import("./notebooksRepo");
  const notebook = notebooks.listNotebooks()[0] ?? notebooks.createNotebook("Notebook");
  return { service, groups, notes, notebook };
}

describe("importPdf", () => {
  it("makes a note titled from the file, in the group and notebook asked for, that owns the PDF", async () => {
    const { service, groups, notebook } = await setup();
    const group = groups.createGroup("Textbooks", null, notebook.id);

    const result = await service.importPdf(pdf("Designing_Data-Intensive_Applications.pdf"), { groupId: group.id, notebookId: notebook.id });

    expect(result.status).toBe("added");
    if (result.status !== "added") return;
    expect(result.note).toEqual(expect.objectContaining({ title: "Designing Data-Intensive Applications", groupId: group.id }));
    expect(result.document).toEqual(expect.objectContaining({ noteId: result.note.id, fileName: "Designing_Data-Intensive_Applications.pdf", pageCount: 0 }));
    expect(result.document).not.toHaveProperty("storedName");
    expect(result.document).not.toHaveProperty("sha256");
    expect(await service.listDocuments()).toEqual([result.document]);
    expect((await service.loadWorkspace()).notes.map((n) => n.id)).toContain(result.note.id);
    expect(storedFiles()).toHaveLength(1);
  });

  it("leaves no note behind when the file is refused", async () => {
    const { service, notes, notebook } = await setup();
    const before = notes.listNotes().length;
    const text = path.join(source, "notes.txt");
    fs.writeFileSync(text, "just text");

    const result = await service.importPdf(text, { groupId: null, notebookId: notebook.id });

    expect(result).toEqual({ status: "refused", error: "notes.txt: this doesn't look like a PDF." });
    expect(notes.listNotes()).toHaveLength(before);
    expect((await service.loadTrash()).notes).toEqual([]);
    expect(storedFiles()).toEqual([]);
  });

  it("offers the PDF you already have, naming its note, and leaves no note or file behind", async () => {
    const { service, notes, notebook } = await setup();
    const first = await service.importPdf(pdf("book.pdf"), { groupId: null, notebookId: notebook.id });
    if (first.status !== "added") throw new Error("expected the first import to be added");
    const before = notes.listNotes().length;

    const again = await service.importPdf(pdf("book copy.pdf"), { groupId: null, notebookId: notebook.id });

    expect(again).toEqual({ status: "duplicate", existing: [{ document: first.document, noteTitle: "book" }] });
    expect(notes.listNotes()).toHaveLength(before);
    expect(storedFiles()).toHaveLength(1);
    expect((await service.loadTrash()).notes).toEqual([]);
  });

  it("names the owner of a duplicate that is in the Trash Can, and imports a separate copy when asked", async () => {
    const { service, notebook } = await setup();
    const first = await service.importPdf(pdf("book.pdf"), { groupId: null, notebookId: notebook.id });
    if (first.status !== "added") throw new Error("expected the first import to be added");
    await service.deleteNote(first.note.id);

    const again = await service.importPdf(pdf("book copy.pdf"), { groupId: null, notebookId: notebook.id });
    expect(again).toEqual({ status: "duplicate", existing: [{ document: first.document, noteTitle: "book" }] });

    const copy = await service.importPdf(pdf("book copy.pdf"), { groupId: null, notebookId: notebook.id }, { allowDuplicate: true });
    expect(copy.status).toBe("added");
    expect(storedFiles()).toHaveLength(2);
  });

  it("finds a PDF's file for the app scheme to serve, and says nothing for one that is gone", async () => {
    const { service, notebook } = await setup();
    const result = await service.importPdf(pdf("book.pdf"), { groupId: null, notebookId: notebook.id });
    if (result.status !== "added") throw new Error("expected an added PDF");

    const found = service.findDocumentFile(result.document.id);
    expect(found).toEqual({ path: expect.stringContaining(path.join(".composition", "documents")), fileName: "book.pdf" });
    expect(fs.existsSync(found!.path)).toBe(true);
    expect(service.findDocumentFile(9999)).toBeNull();
    fs.rmSync(found!.path);
    expect(service.findDocumentFile(result.document.id)).toBeNull();
  });
});

describe("the reader's own calls", () => {
  it("records the page count and the reading position, and keeps bookmarks", async () => {
    const { service, notebook } = await setup();
    const result = await service.importPdf(pdf("book.pdf"), { groupId: null, notebookId: notebook.id });
    if (result.status !== "added") throw new Error("expected an added PDF");
    const id = result.document.id;

    await service.setDocumentPageCount(id, 412);
    await service.saveDocumentViewState(id, { page: 40, zoom: 1.5, darkPages: true });
    const bookmark = await service.addBookmark(id, 12, "Chapter 2");
    await service.renameBookmark(bookmark.id, "Ch. 2");

    expect((await service.listDocuments())[0]).toEqual(expect.objectContaining({ pageCount: 412, viewState: { page: 40, zoom: 1.5, darkPages: true } }));
    expect(await service.listBookmarks(id)).toEqual([expect.objectContaining({ page: 12, label: "Ch. 2" })]);
    await service.removeBookmark(bookmark.id);
    expect(await service.listBookmarks(id)).toEqual([]);
  });

  it("lists a trashed PDF note in the Trash Can with what its PDF holds, and a plain one without", async () => {
    const { service, notebook } = await setup();
    const plain = await service.createNote("A plain note", null, notebook.id);
    const result = await service.importPdf(pdf("book.pdf"), { groupId: null, notebookId: notebook.id });
    if (result.status !== "added") throw new Error("expected an added PDF");
    await service.addBookmark(result.document.id, 0, "start");
    await service.deleteNote(plain.id);
    await service.deleteNote(result.note.id);

    const { notes } = await service.loadTrash();

    expect(notes.find((n) => n.id === plain.id)).not.toHaveProperty("pdf");
    expect(notes.find((n) => n.id === result.note.id)?.pdf).toEqual(expect.objectContaining({ fileName: "book.pdf", bookmarks: 1 }));
  });

  it("says what deleting a PDF's note would take with it", async () => {
    const { service, notebook } = await setup();
    const marks = await import("./pdfMarkupRepo");
    const result = await service.importPdf(pdf("book.pdf", "x".repeat(2000)), { groupId: null, notebookId: notebook.id });
    if (result.status !== "added") throw new Error("expected an added PDF");
    await service.setDocumentPageCount(result.document.id, 20);
    for (const page of [1, 2, 3]) marks.addAnnotation(result.document.id, { page, kind: "highlight", color: "yellow", rects: [[0, 0, 1, 1]] });
    marks.addAnnotation(result.document.id, { page: 4, kind: "underline", color: "green", rects: [[0, 0, 1, 1]] });
    marks.addAnnotation(result.document.id, { page: 5, kind: "ink", color: "black", body: { strokes: [] } });
    marks.addAnnotation(result.document.id, { page: 5, kind: "ink", color: "black", body: { strokes: [1] } });
    await service.addBookmark(result.document.id, 7, "a");

    const contents = await service.describeDocument(result.note.id);

    expect(contents).toEqual({
      fileName: "book.pdf",
      size: expect.any(Number),
      marks: { highlight: 3, underline: 1, strikethrough: 0, text: 0, ink: 2 },
      inkPages: 1,
      bookmarks: 1,
    });
    expect(describeContents(contents!)).toBe("its PDF (2 KB), 3 highlights, 1 underline, 1 ink page and 1 bookmark");
    expect(await service.describeDocument(9999)).toBeNull();
  });
});

describe("describeContents", () => {
  const empty = { fileName: "a.pdf", size: 212_000_000, marks: { highlight: 0, underline: 0, strikethrough: 0, text: 0, ink: 0 }, inkPages: 0, bookmarks: 0 };

  it("is just the PDF when nobody has marked it", () => {
    expect(describeContents(empty)).toBe("its PDF (212 MB)");
  });

  it("lists what is there, leaving out what is not, in the singular for one", () => {
    expect(describeContents({ ...empty, marks: { ...empty.marks, highlight: 41 }, inkPages: 2, bookmarks: 6 })).toBe("its PDF (212 MB), 41 highlights, 2 ink pages and 6 bookmarks");
    expect(describeContents({ ...empty, marks: { ...empty.marks, strikethrough: 1, text: 1 } })).toBe("its PDF (212 MB), 1 strikethrough and 1 text note");
    expect(describeContents({ ...empty, bookmarks: 1 })).toBe("its PDF (212 MB) and 1 bookmark");
  });
});

describe("pdfTitleFromFileName", () => {
  it.each([
    ["Designing_Data-Intensive_Applications.pdf", "Designing Data-Intensive Applications"],
    ["/Users/me/Downloads/Linear Algebra.PDF", "Linear Algebra"],
    ["C:\\docs\\manual__v2.pdf", "manual v2"],
    ["  spaced   out .pdf", "spaced out"],
    [".pdf", "PDF"],
    ["noextension", "noextension"],
  ])("makes %s into %s", (input, title) => {
    expect(pdfTitleFromFileName(input)).toBe(title);
  });
});
