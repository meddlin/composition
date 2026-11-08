// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfDocument } from "@/lib/composition/documentsApi";
import type { DocumentsStore } from "@/lib/composition/documentsStore";
import { fakeControls } from "./fakeControls";
import type { PdfPairing } from "./PdfReader";
import type { PdfViewer, PdfViewerControls } from "./usePdfViewer";

// pdf.js needs a real browser and real layout, so the hook that drives it is replaced by a fake whose state a test sets: what
// is under test is the reader's own bar, find box, sidebar and the bookkeeping it asks the documents store to do.
let viewer: PdfViewer = { phase: "loading" };
let lastOptions: { documentId: number; viewState: object; onPageCount: (n: number) => void; onViewState: (s: object) => void } | null = null;
vi.mock("./usePdfViewer", () => ({
  usePdfViewer: (_container: unknown, _pages: unknown, options: typeof lastOptions) => {
    lastOptions = options;
    return viewer;
  },
}));
vi.mock("pdfjs-dist/web/pdf_viewer.css", () => ({}));

const { PdfReader } = await import("./PdfReader");

const document_: PdfDocument = { id: 7, uuid: "a".repeat(32), noteId: 3, fileName: "book.pdf", size: 10, pageCount: 0, viewState: {}, createdAt: "x" };

const controls = (): PdfViewerControls => fakeControls();
const ready = (over: Partial<Extract<PdfViewer, { phase: "ready" }>> = {}): PdfViewer => ({
  phase: "ready",
  pageCount: 12,
  page: 4,
  labels: ["i", "ii", "iii", "1", "2", "3"],
  scale: 1,
  outline: [{ title: "Chapter One", dest: "ch1", items: [] }],
  find: null,
  controls: controls(),
  ...over,
});

/** What the store says of marks, which a test sets: the reader reads them from it. */
let marksState: Record<number, unknown> = {};
// A store's snapshot is the same object until something changes, which useSyncExternalStore depends on.
let cachedSnapshot: { marks: Record<number, unknown> } | null = null;
const stableSnapshot = () => {
  if (cachedSnapshot?.marks !== marksState) cachedSnapshot = { status: "ready", documents: [document_], error: null, marks: marksState } as never;
  return cachedSnapshot as never;
};

function documents(over: Partial<DocumentsStore> = {}) {
  return {
    subscribe: () => () => {},
    getSnapshot: stableSnapshot,
    loadMarks: vi.fn(async () => {}),
    addMarks: vi.fn(async () => ({ marks: [] })),
    changeMark: vi.fn(async () => ({})),
    removeMark: vi.fn(async () => ({})),
    undoMark: vi.fn(async () => ({})),
    redoMark: vi.fn(async () => ({})),
    byId: vi.fn(() => ({ ...document_, viewState: { page: 3 } })),
    saveViewState: vi.fn(),
    setPageCount: vi.fn(),
    listBookmarks: vi.fn(async () => []),
    addBookmark: vi.fn(async () => ({}) as never),
    renameBookmark: vi.fn(async () => null),
    removeBookmark: vi.fn(async () => {}),
    ...over,
  } as unknown as DocumentsStore & Record<string, ReturnType<typeof vi.fn>>;
}

beforeEach(() => {
  marksState = {};
  cachedSnapshot = null;
  viewer = { phase: "loading" };
  lastOptions = null;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

describe("the reader", () => {
  it("says it is opening the PDF, and keeps the tools out of reach until it is open", () => {
    render(<PdfReader document={document_} documents={documents()} />);

    expect(screen.getByText("Opening the PDF…")).toBeTruthy();
    for (const name of ["Zoom in", "Zoom out", "Fit to width", "Find in this PDF", "Bookmark this page"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true);
    }
    expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("shows why a PDF could not be opened", () => {
    viewer = { phase: "error", message: "This PDF's file is missing from the application data folder." };
    render(<PdfReader document={document_} documents={documents()} />);

    expect(screen.getByRole("alert").textContent).toContain("missing from the application data folder");
  });

  it("starts the viewer on the PDF's id, with the reading position it was left at and the dark-pages choice", () => {
    render(<PdfReader document={{ ...document_, viewState: { page: 9, zoom: 1.5, darkPages: true } }} documents={documents()} />);

    expect(lastOptions?.documentId).toBe(7);
    expect(lastOptions?.viewState).toEqual({ page: 9, zoom: 1.5, darkPages: true });
  });

  it("hands the page count and the reading position on to the documents store", () => {
    const store = documents();
    render(<PdfReader document={document_} documents={store} />);

    lastOptions?.onPageCount(412);
    lastOptions?.onViewState({ page: 5 });

    expect(store.setPageCount).toHaveBeenCalledWith(7, 412);
    expect(store.saveViewState).toHaveBeenCalledWith(7, { page: 5 });
  });

  describe("once open", () => {
    it("shows the page, how many there are, and the printed label when it differs", () => {
      viewer = ready({ page: 4 });
      render(<PdfReader document={document_} documents={documents()} />);

      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("4");
      expect(screen.getByText("of 12")).toBeTruthy();
      expect(screen.getByText("(page 1)")).toBeTruthy();
    });

    it("leaves out the label when it is the number", () => {
      viewer = ready({ page: 9, labels: null });
      render(<PdfReader document={document_} documents={documents()} />);

      expect(screen.queryByText(/\(page/)).toBeNull();
    });

    it("goes to the page that is typed over the number when Enter is pressed, and drops anything that is not a digit", () => {
      const c = controls();
      viewer = ready({ controls: c });
      render(<PdfReader document={document_} documents={documents()} />);
      const box = screen.getByRole("textbox", { name: "Page number" });

      fireEvent.change(box, { target: { value: "1a2" } });
      expect((box as HTMLInputElement).value).toBe("12");
      fireEvent.keyDown(box, { key: "Enter" });

      expect(c.goToPage).toHaveBeenCalledWith(12);
    });

    it("stays where it is when Enter is pressed with nothing typed, or with the page that is already shown", () => {
      const c = controls();
      viewer = ready({ controls: c, page: 6 });
      render(<PdfReader document={document_} documents={documents()} />);
      const box = screen.getByRole("textbox", { name: "Page number" });

      fireEvent.keyDown(box, { key: "Enter" });
      expect(c.goToPage).not.toHaveBeenCalled();

      fireEvent.change(box, { target: { value: "" } });
      fireEvent.keyDown(box, { key: "Enter" });
      expect(c.goToPage).not.toHaveBeenCalled();
    });

    it("gives up what was typed on Escape or when the reader moves", () => {
      const c = controls();
      viewer = ready({ controls: c });
      const { rerender } = render(<PdfReader document={document_} documents={documents()} />);
      const box = screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement;

      fireEvent.change(box, { target: { value: "9" } });
      fireEvent.keyDown(box, { key: "Escape" });
      expect(box.value).toBe("4");

      fireEvent.change(box, { target: { value: "9" } });
      viewer = ready({ controls: c, page: 6 });
      rerender(<PdfReader document={document_} documents={documents()} />);
      expect((screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement).value).toBe("6");
      expect(c.goToPage).not.toHaveBeenCalled();
    });

    it("zooms and fits the width", () => {
      const c = controls();
      viewer = ready({ controls: c });
      render(<PdfReader document={document_} documents={documents()} />);

      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
      fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));

      expect(c.zoomIn).toHaveBeenCalledTimes(1);
      expect(c.zoomOut).toHaveBeenCalledTimes(1);
      expect(c.fitWidth).toHaveBeenCalledTimes(1);
    });

    it("inverts the pages and remembers it, keeping where the reader was", () => {
      viewer = ready();
      const store = documents();
      render(<PdfReader document={document_} documents={store} />);
      const toggle = screen.getByRole("button", { name: "Dark pages" });
      expect(toggle.getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(toggle);

      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(store.saveViewState).toHaveBeenCalledWith(7, { page: 3, darkPages: true });
      expect(screen.getByRole("document").className).toContain("invert(1)");

      fireEvent.click(toggle);
      expect(store.saveViewState).toHaveBeenLastCalledWith(7, { page: 3, darkPages: false });
    });

    it("bookmarks the page the reader is on (0-based in the store) and opens the bookmarks", async () => {
      viewer = ready({ page: 6 });
      const store = documents();
      render(<PdfReader document={document_} documents={store} />);

      fireEvent.click(screen.getByRole("button", { name: "Bookmark this page" }));

      await waitFor(() => expect(store.addBookmark).toHaveBeenCalledWith(7, 5, ""));
      expect((await screen.findByRole("tab", { name: "bookmarks" })).getAttribute("aria-selected")).toBe("true");
    });

    it("opens the outline from the sidebar button, and switches to the bookmarks", async () => {
      viewer = ready();
      render(<PdfReader document={document_} documents={documents()} />);
      expect(screen.queryByRole("complementary", { name: "PDF sidebar" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Outline and bookmarks" }));
      const sidebar = screen.getByRole("complementary", { name: "PDF sidebar" });
      expect(within(sidebar).getByRole("button", { name: "Chapter One" })).toBeTruthy();

      fireEvent.click(within(sidebar).getByRole("tab", { name: "bookmarks" }));
      expect(await within(sidebar).findByText(/No bookmarks yet/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Outline and bookmarks" }));
      expect(screen.queryByRole("complementary", { name: "PDF sidebar" })).toBeNull();
    });

    it("finds as you type, counts the matches, steps through them and puts the bar away", () => {
      const c = controls();
      viewer = ready({ controls: c, find: { current: 2, total: 5, notFound: false } });
      render(<PdfReader document={document_} documents={documents()} />);

      fireEvent.click(screen.getByRole("button", { name: "Find in this PDF" }));
      const box = screen.getAllByRole("textbox", { name: "Find in this PDF" })[0];
      fireEvent.change(box, { target: { value: "b-tree" } });
      expect(c.find).toHaveBeenLastCalledWith("b-tree");
      expect(screen.getByText("2 of 5")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Next match" }));
      expect(c.find).toHaveBeenLastCalledWith("b-tree");
      fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
      expect(c.find).toHaveBeenLastCalledWith("b-tree", { findPrevious: true });
      fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
      expect(c.find).toHaveBeenLastCalledWith("b-tree", { findPrevious: true });

      fireEvent.keyDown(box, { key: "Escape" });
      expect(c.closeFind).toHaveBeenCalled();
      expect(screen.queryByRole("search")).toBeNull();
    });

    it("says when nothing was found", () => {
      viewer = ready({ find: { current: 0, total: 0, notFound: true } });
      render(<PdfReader document={document_} documents={documents()} />);

      fireEvent.click(screen.getByRole("button", { name: "Find in this PDF" }));
      fireEvent.change(screen.getAllByRole("textbox", { name: "Find in this PDF" })[0], { target: { value: "zzz" } });

      expect(screen.getByText("Not found")).toBeTruthy();
    });

    it("opens find on Ctrl+F or Cmd+F", () => {
      viewer = ready();
      render(<PdfReader document={document_} documents={documents()} />);

      fireEvent.keyDown(screen.getByRole("document"), { key: "f", ctrlKey: true });

      expect(screen.getByRole("search")).toBeTruthy();
    });
  });

  describe("the marks", () => {
    const mark = (id: number, over: Record<string, unknown> = {}) => ({ id, uuid: String(id).padStart(32, "0"), documentId: 7, page: 3, kind: "highlight", color: "yellow", rects: [[72, 690, 300, 714]], quote: "a marked line", comment: "", body: null, groupUuid: null, createdAt: "t", updatedAt: "t", ...over });

    it("asks the store for the PDF's marks when it opens", () => {
      const store = documents();
      render(<PdfReader document={document_} documents={store} />);

      expect(store.loadMarks).toHaveBeenCalledWith(7);
    });

    it("keeps Undo and Redo out of reach until there is something to undo or redo, and uses the store's", () => {
      viewer = ready();
      const store = documents();
      const { rerender } = render(<PdfReader document={document_} documents={store} />);
      expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);

      marksState = { 7: { status: "ready", items: [], error: null, undoCount: 2, redoCount: 1 } };
      rerender(<PdfReader document={{ ...document_ }} documents={documents()} />);
      const again = documents();
      rerender(<PdfReader document={{ ...document_ }} documents={again} />);
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));

      expect((screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(false);
      expect(again.undoMark).toHaveBeenCalledWith(7);
      expect(again.redoMark).toHaveBeenCalledWith(7);
    });

    it("undoes on Ctrl+Z and redoes on Ctrl+Shift+Z or Ctrl+Y, but not while a box is being typed in", () => {
      viewer = ready();
      const store = documents();
      render(<PdfReader document={document_} documents={store} />);
      const pages = screen.getByRole("document");

      fireEvent.keyDown(pages, { key: "z", code: "KeyZ", ctrlKey: true });
      fireEvent.keyDown(pages, { key: "z", code: "KeyZ", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(pages, { key: "y", code: "KeyY", ctrlKey: true });
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Page number" }), { key: "z", code: "KeyZ", ctrlKey: true });

      expect(store.undoMark).toHaveBeenCalledTimes(1);
      expect(store.redoMark).toHaveBeenCalledTimes(2);
    });

    it("turns on placing a text note, and says so, and turns it off again", () => {
      viewer = ready();
      render(<PdfReader document={document_} documents={documents()} />);
      const button = screen.getByRole("button", { name: "Add a text note" });

      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      fireEvent.keyDown(screen.getByRole("document"), { key: "Escape" });

      expect(button.getAttribute("aria-pressed")).toBe("false");
    });

    it("lists the marks in the Highlights tab by page, and says when there are none", async () => {
      viewer = ready();
      const { rerender } = render(<PdfReader document={document_} documents={documents()} />);
      fireEvent.click(screen.getByRole("button", { name: "Outline and bookmarks" }));
      fireEvent.click(screen.getByRole("tab", { name: "highlights" }));
      expect(screen.getByText(/No highlights yet/)).toBeTruthy();

      marksState = { 7: { status: "ready", items: [mark(1), mark(2, { page: 5, kind: "underline", color: "green", quote: "another line", comment: "check" })], error: null, undoCount: 0, redoCount: 0 } };
      rerender(<PdfReader document={{ ...document_ }} documents={documents()} />);

      const list = screen.getByRole("list", { name: "Highlights" });
      expect(within(list).getByText("a marked line")).toBeTruthy();
      expect(within(list).getByText("another line")).toBeTruthy();
      expect(within(list).getByText("Page 1")).toBeTruthy();
      expect(within(list).getByText("check")).toBeTruthy();
    });

    it("shows what went wrong, and lets it be dismissed", async () => {
      viewer = ready();
      const store = documents({ undoMark: vi.fn(async () => ({ error: "That mark is gone." })) } as never);
      render(<PdfReader document={document_} documents={store} />);

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      marksState = { 7: { status: "ready", items: [], error: null, undoCount: 1, redoCount: 0 } };
      fireEvent.keyDown(screen.getByRole("document"), { key: "z", code: "KeyZ", ctrlKey: true });

      expect(await screen.findByText("That mark is gone.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText("That mark is gone.")).toBeNull();
    });
  });
});

describe("the notes beside the PDF", () => {
  const markUuid = String(1).padStart(32, "0");
  const mark = (id: number, over: Record<string, unknown> = {}) => ({ id, uuid: String(id).padStart(32, "0"), documentId: 7, page: 3, kind: "highlight", color: "yellow", rects: [[72, 690, 300, 714]], quote: "a marked line", comment: "", body: null, groupUuid: null, createdAt: "t", updatedAt: "t", ...over });
  const showMarks = (items: unknown[]) => {
    marksState = { 7: { status: "ready", items, error: null, undoCount: 0, redoCount: 0 } };
  };
  const pairing = (over: Partial<PdfPairing> = {}): PdfPairing => ({
    title: "Designing Data",
    citations: [
      { noteId: 3, title: "Designing Data", owner: true, pages: [], marks: [] },
      { noteId: 8, title: "Chapter 3", owner: false, pages: [44, 9], marks: [markUuid] },
    ],
    noteId: 8,
    noteTitle: "Chapter 3",
    follow: false,
    insert: vi.fn(() => true),
    onToggleFollow: vi.fn(),
    onOpenNote: vi.fn(),
    onNewNote: vi.fn(),
    onGoToDone: vi.fn(),
    ...over,
  });
  const openSidebar = (tab: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Outline and bookmarks" }));
    fireEvent.click(screen.getByRole("tab", { name: tab }));
  };

  it("has no Notes tab, no Cite this page and no Quote when it is not paired with notes", () => {
    viewer = ready();
    showMarks([mark(1)]);
    render(<PdfReader document={document_} documents={documents()} />);
    openSidebar("highlights");

    expect(screen.queryByRole("tab", { name: "notes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cite this page" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Quote the/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow the note in use" })).toBeNull();
  });

  describe("the Notes tab", () => {
    it("lists the PDF's own note first and the notes that cite it, and marks the one it is paired with", () => {
      viewer = ready();
      render(<PdfReader document={document_} documents={documents()} pairing={pairing()} />);
      openSidebar("notes");

      const items = within(screen.getByRole("list", { name: "Notes" })).getAllByRole("button");
      expect(items.map((b) => b.textContent)).toEqual(["Designing DataThis PDF's own note", "Chapter 3Cites this PDF · 2 pages"]);
      expect(items[1].getAttribute("aria-current")).toBe("true");
      expect(items[0].getAttribute("aria-current")).toBeNull();
    });

    it("opens a note in the paired note panel when it is picked", () => {
      viewer = ready();
      const p = pairing();
      render(<PdfReader document={document_} documents={documents()} pairing={p} />);
      openSidebar("notes");

      fireEvent.click(screen.getByRole("button", { name: /Designing Data/ }));

      expect(p.onOpenNote).toHaveBeenCalledWith(3);
    });

    it("offers a new note for this PDF", () => {
      viewer = ready();
      const p = pairing();
      render(<PdfReader document={document_} documents={documents()} pairing={p} />);
      openSidebar("notes");

      fireEvent.click(screen.getByRole("button", { name: "New note for this PDF" }));

      expect(p.onNewNote).toHaveBeenCalled();
    });
  });

  describe("Quote", () => {
    it("puts a highlight's words into the paired note as a block quote that cites the page by its printed label, naming the mark", () => {
      viewer = ready();
      showMarks([mark(1)]);
      const p = pairing();
      render(<PdfReader document={document_} documents={documents()} pairing={p} />);
      openSidebar("highlights");

      fireEvent.click(screen.getByRole("button", { name: "Quote the highlight on page 1" }));

      expect(p.insert).toHaveBeenCalledWith(`> a marked line\n>\n> — [*Designing Data*, p. 1](pdf:${document_.uuid}#p=4&a=${markUuid})`, "block");
    });

    it("is not offered for a text note, which has words of its own and no quote", () => {
      viewer = ready();
      showMarks([mark(2, { kind: "text", rects: null, quote: "", body: { rect: [1, 1, 50, 50], text: "mine" } })]);
      render(<PdfReader document={document_} documents={documents()} pairing={pairing()} />);
      openSidebar("highlights");

      expect(screen.queryByRole("button", { name: /^Quote the/ })).toBeNull();
    });

    it("shows which highlights a note already quotes, and which notes", () => {
      viewer = ready();
      showMarks([mark(1), mark(2, { quote: "never quoted" })]);
      render(<PdfReader document={document_} documents={documents()} pairing={pairing()} />);
      openSidebar("highlights");

      expect(screen.getAllByLabelText(/^Quoted in/)).toHaveLength(1);
      expect(screen.getByLabelText("Quoted in Chapter 3")).toBeTruthy();
    });

    it("says there is no note to write in when the PDF has none paired, and writes nothing", () => {
      viewer = ready();
      showMarks([mark(1)]);
      const p = pairing({ noteId: null, noteTitle: null });
      render(<PdfReader document={document_} documents={documents()} pairing={p} />);
      openSidebar("highlights");

      fireEvent.click(screen.getByRole("button", { name: "Quote the highlight on page 1" }));

      expect(screen.getByRole("alert").textContent).toContain("Open a note beside this PDF to write in.");
      expect(p.insert).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says so when the note is no longer there to write in", () => {
      viewer = ready();
      showMarks([mark(1)]);
      render(<PdfReader document={document_} documents={documents()} pairing={pairing({ insert: vi.fn(() => false) })} />);
      openSidebar("highlights");

      fireEvent.click(screen.getByRole("button", { name: "Quote the highlight on page 1" }));

      expect(screen.getByRole("alert").textContent).toContain("no longer there");
    });
  });

  describe("Cite this page", () => {
    it("puts a link to the page the reader is on into the paired note, inline", () => {
      viewer = ready({ page: 4 });
      const p = pairing();
      render(<PdfReader document={document_} documents={documents()} pairing={p} />);

      fireEvent.click(screen.getByRole("button", { name: "Cite this page" }));

      expect(p.insert).toHaveBeenCalledWith(`[*Designing Data*, p. 1](pdf:${document_.uuid}#p=4)`, "inline");
    });

    it("waits until the PDF is open", () => {
      render(<PdfReader document={document_} documents={documents()} pairing={pairing()} />);

      expect((screen.getByRole("button", { name: "Cite this page" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it("says whether it follows the note in use or stays with one, and switches between them", () => {
    viewer = ready();
    const p = pairing();
    const { rerender } = render(<PdfReader document={document_} documents={documents()} pairing={p} />);
    const toggle = screen.getByRole("button", { name: "Follow the note in use" });

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("title")).toContain("“Chapter 3”");
    fireEvent.click(toggle);
    expect(p.onToggleFollow).toHaveBeenCalled();

    rerender(<PdfReader document={document_} documents={documents()} pairing={pairing({ follow: true })} />);
    expect(screen.getByRole("button", { name: "Follow the note in use" }).getAttribute("aria-pressed")).toBe("true");
  });

  describe("a followed link", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("goes to the mark it names once the marks are known, and says it has, after the mark has had its moment", () => {
      const c = controls();
      viewer = ready({ controls: c });
      const p = pairing({ goTo: { page: 4, mark: markUuid, seq: 3 } });
      const { rerender } = render(<PdfReader document={document_} documents={documents()} pairing={p} />);
      // the marks have not been read yet: the reader waits for them rather than guess where the mark is
      expect(c.goToRect).not.toHaveBeenCalled();
      expect(c.goToPage).not.toHaveBeenCalled();

      showMarks([mark(1)]);
      rerender(<PdfReader document={document_} documents={documents()} pairing={p} />);

      expect(c.goToRect).toHaveBeenCalledWith(4, [72, 690, 300, 714]);
      expect(p.onGoToDone).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(1700));
      expect(p.onGoToDone).toHaveBeenCalledWith(3);
    });

    it("goes to the page when the link names no mark, or the mark is gone, and never past the last page", () => {
      const c = controls();
      viewer = ready({ controls: c, pageCount: 12 });
      showMarks([]);
      const { rerender } = render(<PdfReader document={document_} documents={documents()} pairing={pairing({ goTo: { page: 9, mark: null, seq: 1 } })} />);
      expect(c.goToPage).toHaveBeenLastCalledWith(9);

      rerender(<PdfReader document={document_} documents={documents()} pairing={pairing({ goTo: { page: 5, mark: "f".repeat(32), seq: 2 } })} />);
      expect(c.goToPage).toHaveBeenLastCalledWith(5);

      rerender(<PdfReader document={document_} documents={documents()} pairing={pairing({ goTo: { page: 99, mark: null, seq: 3 } })} />);
      expect(c.goToPage).toHaveBeenLastCalledWith(12);
    });

    it("shows a request once, however many times the reader redraws, and again for a new one", () => {
      const c = controls();
      viewer = ready({ controls: c });
      showMarks([]);
      const goTo = { page: 9, mark: null, seq: 1 };
      const { rerender } = render(<PdfReader document={document_} documents={documents()} pairing={pairing({ goTo })} />);

      viewer = ready({ controls: c, page: 5 });
      rerender(<PdfReader document={document_} documents={documents()} pairing={pairing({ goTo })} />);
      expect(c.goToPage).toHaveBeenCalledTimes(1);

      rerender(<PdfReader document={document_} documents={documents()} pairing={pairing({ goTo: { ...goTo, seq: 2 } })} />);
      expect(c.goToPage).toHaveBeenCalledTimes(2);
    });

    it("waits for the PDF to open", () => {
      viewer = { phase: "loading" };
      showMarks([]);
      const p = pairing({ goTo: { page: 9, mark: null, seq: 1 } });
      const { rerender } = render(<PdfReader document={document_} documents={documents()} pairing={p} />);
      const c = controls();

      viewer = ready({ controls: c });
      rerender(<PdfReader document={document_} documents={documents()} pairing={p} />);

      expect(c.goToPage).toHaveBeenCalledWith(9);
    });
  });
});
