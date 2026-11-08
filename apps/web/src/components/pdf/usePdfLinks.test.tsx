// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeDocumentsApi } from "@/lib/composition/__fixtures__/documentsApi";
import type { PdfDocument } from "@/lib/composition/documentsApi";
import { createDocumentsStore } from "@/lib/composition/documentsStore";
import { createWorkspaceStore, type WorkspaceDeps } from "../notes/workspaceStore";
import type { Note } from "../notes/types";
import { usePdfLinks } from "./usePdfLinks";

afterEach(cleanup);

const note = (id: number): Note => ({ id, title: `Note ${id}`, content: "", tags: "", description: "", createdAt: "x", updatedAt: "x", groupId: null, notebookId: 1 });
const book: PdfDocument = { id: 10, uuid: "a".repeat(32), noteId: 2, fileName: "book.pdf", size: 1, pageCount: 0, viewState: {}, createdAt: "x" };

function setup(notes: Note[], available = true) {
  const store = createWorkspaceStore({ notes, groups: [] }, { deleteNote: vi.fn(async () => {}) } as unknown as WorkspaceDeps, undefined, {
    documents: createDocumentsStore(fakeDocumentsApi({ listDocuments: vi.fn(async () => [book]) }), available),
    panels: {},
  });
  return store;
}

describe("usePdfLinks", () => {
  it("calls a link good when the PDF is here and its note is live, and dead for any other PDF", async () => {
    const store = setup([note(1), note(2)]);
    const { result } = renderHook(() => usePdfLinks(store, "p1", store.getSnapshot().notes));

    await waitFor(() => expect(result.current?.exists(book.uuid)).toBe(true));
    expect(result.current?.exists("f".repeat(32))).toBe(false);
  });

  it("calls a link dead when the PDF's note is in the Trash Can, and good again when it is restored", async () => {
    const store = setup([note(1), note(2)]);
    await store.documents.load();
    const live = renderHook(() => usePdfLinks(store, "p1", [note(1), note(2)]));
    const trashed = renderHook(() => usePdfLinks(store, "p1", [note(1)]));

    expect(live.result.current?.exists(book.uuid)).toBe(true);
    expect(trashed.result.current?.exists(book.uuid)).toBe(false);
  });

  it("follows the link in the panel it is for", async () => {
    const store = setup([note(1), note(2)]);
    await store.documents.load();
    const open = vi.spyOn(store, "openLinkedPdf");
    const { result } = renderHook(() => usePdfLinks(store, "p7", store.getSnapshot().notes));

    act(() => result.current?.open({ uuid: book.uuid, page: 3, mark: null }));

    expect(open).toHaveBeenCalledWith({ uuid: book.uuid, page: 3, mark: null }, "p7");
  });

  it("is nothing where there are no PDFs, so that every pdf: link there is dead", () => {
    const store = setup([note(1)], false);
    const { result } = renderHook(() => usePdfLinks(store, "p1", store.getSnapshot().notes));

    expect(result.current).toBeUndefined();
  });
});
