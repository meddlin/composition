// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentsApi, ImportPdfResult, PdfContents, PdfDocument } from "@/lib/composition/documentsApi";
import { fakeDocumentsApi } from "@/lib/composition/__fixtures__/documentsApi";
import { createDocumentsStore } from "@/lib/composition/documentsStore";
import type { Note } from "./types";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { createWorkspaceStore, type WorkspaceDeps } from "./workspaceStore";

afterEach(cleanup);

const note = (id: number, title = `Note ${id}`): Note => ({ id, title, content: "", tags: "", description: "", createdAt: "x", updatedAt: "x", groupId: null, notebookId: 1 });
const pdf = (id: number, noteId: number): PdfDocument => ({ id, uuid: String(id).padStart(32, "0"), noteId, fileName: `book${id}.pdf`, size: 10, pageCount: 0, viewState: {}, createdAt: "x" });
const contents: PdfContents = { fileName: "book10.pdf", size: 212_000_000, marks: { highlight: 41, underline: 0, strikethrough: 0, text: 0, ink: 2 }, inkPages: 2, bookmarks: 6, citingNotes: 3 };

function setup(over: Partial<DocumentsApi> = {}, { available = true, notes = [note(1), note(2, "Textbook")] } = {}) {
  const api = fakeDocumentsApi({
    listDocuments: vi.fn(async () => [pdf(10, 2)]),
    describeDocument: vi.fn(async (noteId: number) => (noteId === 2 ? contents : null)),
    ...over,
  });
  const deps = { deleteNote: vi.fn(async () => {}) } as unknown as WorkspaceDeps;
  const store = createWorkspaceStore({ notes, groups: [] }, deps, undefined, { panels: {}, documents: createDocumentsStore(api, available) });
  const onCreated = vi.fn();
  function Harness() {
    const { actions, groupError, dialog } = useWorkspaceActions(store, { onCreated });
    return (
      <div>
        {actions.onImportPdf && <button onClick={() => actions.onImportPdf?.(4, 1)}>import a pdf</button>}
        <button onClick={() => actions.onDelete(2)}>delete textbook</button>
        <button onClick={() => actions.onDelete(1)}>delete note</button>
        {groupError && <p role="alert">{groupError}</p>}
        {dialog}
      </div>
    );
  }
  render(<Harness />);
  return { store, api, onCreated };
}

describe("importing a PDF from the sidebar", () => {
  it("is offered only where there are PDFs", () => {
    setup({}, { available: false });

    expect(screen.queryByRole("button", { name: "import a pdf" })).toBeNull();
  });

  it("imports into the group and notebook it was asked for, and tells the window a note was made", async () => {
    const made: ImportPdfResult = { note: note(5) as never, document: pdf(50, 5) };
    const { api, onCreated, store } = setup({ importPdf: vi.fn(async () => made) });

    fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.importPdf).toHaveBeenCalledWith({ groupId: 4, notebookId: 1 });
    expect(store.getSnapshot().notes.map((n) => n.id)).toContain(5);
  });

  it("says why a file was refused, and does nothing for a cancelled picker", async () => {
    const { api, onCreated } = setup({ importPdf: vi.fn().mockResolvedValueOnce({ error: "notes.txt: this doesn't look like a PDF." }).mockResolvedValueOnce({ canceled: true }) });

    fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("notes.txt: this doesn't look like a PDF.");

    fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));
    await waitFor(() => expect(api.importPdf).toHaveBeenCalledTimes(2));
    expect(onCreated).not.toHaveBeenCalled();
  });

  describe("of a PDF that is already in the library", () => {
    const duplicate = (existing: { document: PdfDocument; noteTitle: string }[]): ImportPdfResult => ({ duplicate: { token: "tok", fileName: "Textbook.pdf", existing } });

    it("asks, naming the note that has it, before importing anything", async () => {
      const { api } = setup({ importPdf: vi.fn(async () => duplicate([{ document: pdf(10, 2), noteTitle: "Textbook" }])) });

      fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toContain("You already have this PDF");
      expect(dialog.textContent).toContain("“Textbook.pdf” has exactly the same contents as “Textbook”");
      expect(api.importPdfCopy).not.toHaveBeenCalled();
    });

    it("imports a separate copy, into the place that was asked for, when that is chosen", async () => {
      const copy: ImportPdfResult = { note: note(6, "Textbook copy") as never, document: pdf(60, 6) };
      const { api, store, onCreated } = setup({ importPdf: vi.fn(async () => duplicate([{ document: pdf(10, 2), noteTitle: "Textbook" }])), importPdfCopy: vi.fn(async () => copy) });

      fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));
      fireEvent.click(await screen.findByRole("button", { name: "Import a separate copy" }));

      await waitFor(() => expect(onCreated).toHaveBeenCalled());
      expect(api.importPdfCopy).toHaveBeenCalledWith("tok", { groupId: 4, notebookId: 1 });
      expect(store.getSnapshot().notes.map((n) => n.id)).toContain(6);
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("opens the note that has it, when that is chosen", async () => {
      const { api, store } = setup({ importPdf: vi.fn(async () => duplicate([{ document: pdf(10, 2), noteTitle: "Textbook" }])) });
      await store.documents.load();

      fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));
      fireEvent.click(await screen.findByRole("button", { name: "Open it" }));

      expect(api.importPdfCopy).not.toHaveBeenCalled();
      const kinds = Object.values(store.getSnapshot().panels.byId).map((p) => p.kind).sort();
      expect(kinds).toEqual(["note", "pdf"]);
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("does not offer to open a note that is in the Trash Can, only the copy", async () => {
      setup({ importPdf: vi.fn(async () => duplicate([{ document: pdf(11, 99), noteTitle: "Old textbook" }])) });

      fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));

      await screen.findByRole("alertdialog");
      expect(screen.queryByRole("button", { name: "Open it" })).toBeNull();
      expect(screen.getByRole("button", { name: "Import a separate copy" })).toBeTruthy();
    });

    it("imports nothing on Cancel", async () => {
      const { api } = setup({ importPdf: vi.fn(async () => duplicate([{ document: pdf(10, 2), noteTitle: "Textbook" }])) });

      fireEvent.click(screen.getByRole("button", { name: "import a pdf" }));
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(api.importPdfCopy).not.toHaveBeenCalled();
    });
  });
});

describe("deleting a note that owns a PDF", () => {
  it("names what goes with it: the PDF, the marks and the bookmarks", async () => {
    const { store } = setup();
    await store.documents.load();

    fireEvent.click(screen.getByRole("button", { name: "delete textbook" }));

    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog.textContent).toContain("with its PDF (212 MB), 41 highlights, 2 ink pages and 6 bookmarks"));
    expect(dialog.textContent).toContain("permanently deleted after 60 days");
    expect(dialog.textContent).toContain("3 notes cite it; their quotes stay and their links stop working.");
  });

  it("holds the Delete button until it knows what is inside", async () => {
    let finish: (value: PdfContents) => void = () => {};
    const { store } = setup({ describeDocument: vi.fn(() => new Promise<PdfContents>((resolve) => (finish = resolve)) as never) });
    await store.documents.load();

    fireEvent.click(screen.getByRole("button", { name: "delete textbook" }));
    const dialog = await screen.findByRole("alertdialog");
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => finish(contents));

    await waitFor(() => expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false));
    expect(dialog.textContent).toContain("its PDF (212 MB)");
  });

  it("asks about an ordinary note as it always did, without looking for a PDF", async () => {
    const { store, api } = setup();
    await store.documents.load();

    fireEvent.click(screen.getByRole("button", { name: "delete note" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("It moves to the Trash Can in Settings, where you can restore it. Items in the Trash Can are permanently deleted after 60 days.");
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
    expect(api.describeDocument).not.toHaveBeenCalled();
  });

  it("deletes the note on confirm", async () => {
    const { store } = setup();
    await store.documents.load();

    fireEvent.click(screen.getByRole("button", { name: "delete textbook" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(store.getSnapshot().notes.map((n) => n.id)).toEqual([1]);
  });
});
