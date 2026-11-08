// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { KeyboardEvent, MouseEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotation, PdfDocument } from "@/lib/composition/documentsApi";
import type { DocumentMarks } from "@/lib/composition/documentMarks";
import type { DocumentsStore } from "@/lib/composition/documentsStore";
import { resetLastHighlightColor } from "../notes/lastHighlightColor";
import { fakeControls } from "./fakeControls";
import type { PageOnScreen } from "./selectionMarks";
import { useMarkEditing } from "./useMarkEditing";

const pdf: PdfDocument = { id: 7, uuid: "a".repeat(32), noteId: 3, fileName: "book.pdf", size: 10, pageCount: 12, viewState: {}, createdAt: "x" };

const mark = (over: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
  id: 1,
  uuid: "b".repeat(32),
  documentId: 7,
  page: 2,
  kind: "highlight",
  color: "yellow",
  rects: [[100, 600, 200, 612]],
  quote: "some words",
  comment: "",
  body: null,
  groupUuid: null,
  createdAt: "x",
  updatedAt: "x",
  ...over,
});

// A snapshot is the same object until something changes, which useSyncExternalStore depends on.
let marksState: Record<number, DocumentMarks> = {};
let snapshot: { marks: Record<number, DocumentMarks> } | null = null;
const getSnapshot = () => {
  if (snapshot?.marks !== marksState) snapshot = { status: "ready", documents: [pdf], error: null, marks: marksState } as never;
  return snapshot as never;
};
const showMarks = (items: PdfAnnotation[], extra: Partial<DocumentMarks> = {}) => {
  marksState = { 7: { status: "ready", items, undoCount: 0, redoCount: 0, ...extra } as DocumentMarks };
};

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    subscribe: () => () => {},
    getSnapshot,
    loadMarks: vi.fn(async () => {}),
    addMarks: vi.fn(async (_id: number, inputs: unknown[]) => ({ marks: inputs })),
    changeMark: vi.fn(async () => ({})),
    removeMark: vi.fn(async () => ({})),
    undoMark: vi.fn(async () => ({})),
    redoMark: vi.fn(async () => ({})),
    ...over,
  } as unknown as DocumentsStore & Record<string, ReturnType<typeof vi.fn>>;
}

// jsdom does no layout: a page is 612 x 792 at scale 1, y flipped as pdf.js has it, and a text span's box is its `data-box`.
const viewport = { convertToViewportPoint: (x: number, y: number): [number, number] => [x, 792 - y], convertToPdfPoint: (x: number, y: number): [number, number] => [x, 792 - y] };

let host: HTMLDivElement;
let pages: PageOnScreen[];

function buildPage(number: number, text: string, box: string): PageOnScreen {
  const element = document.createElement("div");
  element.className = "page";
  element.dataset.pageNumber = String(number);
  element.innerHTML = `<div class="canvasWrapper"></div><div class="textLayer"><span data-box="${box}">${text}</span></div>`;
  host.appendChild(element);
  return { pageNumber: number, element, viewport };
}

beforeEach(() => {
  marksState = {};
  snapshot = null;
  resetLastHighlightColor();
  host = document.createElement("div");
  document.body.appendChild(host);
  pages = [];
  Element.prototype.getBoundingClientRect = function () {
    const origin = (this as HTMLElement).classList?.contains("page") ? { left: 100, top: 50 } : { left: 0, top: 0 };
    return { left: origin.left, top: origin.top, right: origin.left + 612, bottom: origin.top + 792, width: 612, height: 792, x: origin.left, y: origin.top, toJSON() {} };
  };
  Object.defineProperty(HTMLElement.prototype, "clientLeft", { configurable: true, get: () => 0 });
  Object.defineProperty(HTMLElement.prototype, "clientTop", { configurable: true, get: () => 0 });
  Range.prototype.getClientRects = function () {
    const spans = Array.from(document.querySelectorAll<HTMLElement>("[data-box]")).filter((s) => this.intersectsNode(s));
    const rects = spans.map((s) => {
      const [l, t, r, b] = s.dataset.box!.split(",").map(Number);
      const frame = s.closest<HTMLElement>(".page")!.getBoundingClientRect();
      return { left: frame.left + l, top: frame.top + t, right: frame.left + r, bottom: frame.top + b, width: r - l, height: b - t, x: frame.left + l, y: frame.top + t, toJSON() {} };
    });
    return Object.assign(rects, { item: (i: number) => rects[i] }) as unknown as DOMRectList;
  };
});

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

function setup(store = fakeStore(), controlsOver: Parameters<typeof fakeControls>[0] = {}) {
  const controls = fakeControls({ pagesOnScreen: vi.fn(() => pages), ...controlsOver });
  const container = { current: host };
  const hook = renderHook(() => useMarkEditing({ pdf, documents: store, controls, container }));
  return { store, controls, ...hook };
}

function selectText(page: PageOnScreen, from = 0, to?: number) {
  const text = page.element.querySelector(".textLayer span")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to ?? text.textContent!.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => void document.dispatchEvent(new Event("selectionchange")));
}

const key = (init: Partial<KeyboardEvent> & { code?: string; key?: string }, target: EventTarget = host) =>
  ({ metaKey: false, ctrlKey: false, shiftKey: false, key: "", code: "", target, preventDefault: vi.fn(), ...init }) as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> };

const clickAt = (target: Element, x: number, y: number) => ({ target, clientX: 100 + x, clientY: 50 + y }) as unknown as MouseEvent;

describe("reading the marks", () => {
  it("asks the store for the PDF's marks once, and says they are loading until they are there", () => {
    const { store, result } = setup();

    expect(store.loadMarks).toHaveBeenCalledWith(7);
    expect(result.current.status).toBe("loading");
    expect(result.current.marks).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("shows the marks the store has, and what can be undone or redone", () => {
    showMarks([mark()], { undoCount: 2, redoCount: 1 });
    const { result } = setup();

    expect(result.current.marks).toHaveLength(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);
  });

  it("passes on why the marks could not be read", () => {
    marksState = { 7: { status: "error", error: "The database is locked.", items: [], undoCount: 0, redoCount: 0 } as never };
    const { result } = setup();

    expect(result.current.readError).toBe("The database is locked.");
  });
});

describe("the selection toolbar", () => {
  it("appears by the text that is selected in a page, and goes when the selection does", () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const { result } = setup();

    expect(result.current.anchor).toBeNull();
    selectText(pages[0]);
    expect(result.current.anchor).toMatchObject({ top: 150, bottom: 162 });

    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current.anchor).toBeNull();
  });

  it("ignores a selection outside the reader", () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const outside = document.createElement("p");
    outside.textContent = "elsewhere on the screen";
    document.body.appendChild(outside);
    const { result } = setup();

    const range = document.createRange();
    range.selectNodeContents(outside);
    window.getSelection()!.addRange(range);
    act(() => void document.dispatchEvent(new Event("selectionchange")));

    expect(result.current.anchor).toBeNull();
  });
});

describe("marking a selection", () => {
  it("adds a mark of the kind asked for, in the chosen color, with the words and lines of the selection", async () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const { store, result } = setup();
    act(() => result.current.chooseColor("green"));
    selectText(pages[0]);

    await act(async () => result.current.markSelection("underline"));

    expect(store.addMarks).toHaveBeenCalledWith(7, [{ page: 2, kind: "underline", color: "green", rects: [[10, 680, 110, 692]], quote: "some words here" }]);
  });

  it("clears the selection and the toolbar once the mark is saved", async () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const { result } = setup();
    selectText(pages[0]);

    await act(async () => result.current.markSelection("highlight"));

    expect(window.getSelection()!.isCollapsed).toBe(true);
    expect(result.current.anchor).toBeNull();
  });

  it("keeps the selection, and says why, when the mark is not saved", async () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const store = fakeStore({ addMarks: vi.fn(async () => ({ error: "Could not save that." })) });
    const { result } = setup(store);
    selectText(pages[0]);

    await act(async () => result.current.markSelection("highlight"));

    expect(result.current.error).toBe("Could not save that.");
    expect(window.getSelection()!.isCollapsed).toBe(false);
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("does nothing when nothing is selected", async () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const { store, result } = setup();

    await act(async () => result.current.markSelection("highlight"));

    expect(store.addMarks).not.toHaveBeenCalled();
  });

  it("remembers the color a mark was last given, for the next one and for the notes' highlights", () => {
    const first = setup();
    act(() => first.result.current.chooseColor("pink"));
    first.unmount();

    const second = setup();

    expect(second.result.current.color).toBe("pink");
  });
});

describe("keys", () => {
  it("marks the selection with Mod+Shift+H, U and S", async () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const { store, result } = setup();
    selectText(pages[0]);

    for (const [code, kind] of [["KeyH", "highlight"], ["KeyU", "underline"], ["KeyS", "strikethrough"]] as const) {
      const event = key({ metaKey: true, shiftKey: true, code });
      let used = false;
      await act(async () => void (used = result.current.onKeyDown(event)));
      expect(used, code).toBe(true);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(vi.mocked(store.addMarks).mock.calls.at(-1)?.[1][0].kind).toBe(kind);
      selectText(pages[0]);
    }
  });

  it("takes Ctrl in place of Cmd, and leaves a bare letter alone", async () => {
    pages = [buildPage(3, "some words here", "10,100,110,112")];
    const { store, result } = setup();
    selectText(pages[0]);

    expect(result.current.onKeyDown(key({ code: "KeyH", shiftKey: true }))).toBe(false);
    expect(result.current.onKeyDown(key({ code: "KeyH", ctrlKey: true }))).toBe(false);
    await act(async () => void result.current.onKeyDown(key({ code: "KeyH", ctrlKey: true, shiftKey: true })));

    expect(store.addMarks).toHaveBeenCalledTimes(1);
  });

  it("undoes with Mod+Z, and redoes with Mod+Shift+Z and Ctrl+Y", async () => {
    const { store, result } = setup();

    await act(async () => void result.current.onKeyDown(key({ metaKey: true, code: "KeyZ" })));
    await act(async () => void result.current.onKeyDown(key({ metaKey: true, shiftKey: true, code: "KeyZ" })));
    await act(async () => void result.current.onKeyDown(key({ ctrlKey: true, code: "KeyY" })));

    expect(store.undoMark).toHaveBeenCalledTimes(1);
    expect(store.redoMark).toHaveBeenCalledTimes(2);
    expect(store.undoMark).toHaveBeenCalledWith(7);
  });

  it("leaves the keys to a text field that has the focus", () => {
    const { store, result } = setup();
    const field = document.createElement("textarea");
    host.appendChild(field);

    const used = result.current.onKeyDown(key({ metaKey: true, code: "KeyZ" }, field));

    expect(used).toBe(false);
    expect(store.undoMark).not.toHaveBeenCalled();
  });

  it("shows a failure to undo", async () => {
    const store = fakeStore({ undoMark: vi.fn(async () => ({ error: "Nothing to undo." })) });
    const { result } = setup(store);

    await act(async () => void result.current.onKeyDown(key({ metaKey: true, code: "KeyZ" })));

    expect(result.current.error).toBe("Nothing to undo.");
  });

  it("deletes the selected mark with Delete or Backspace, and does not claim the key with none selected", async () => {
    const m = mark();
    showMarks([m]);
    const { store, result } = setup();

    expect(result.current.onKeyDown(key({ key: "Delete" }))).toBe(false);
    act(() => result.current.select(1));
    const event = key({ key: "Backspace" });
    await act(async () => void result.current.onKeyDown(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(store.removeMark).toHaveBeenCalledWith(m);
    expect(result.current.selectedId).toBeNull();
  });

  it("lets go of the selected mark, a text note being placed, and a draft with Escape", () => {
    showMarks([mark()]);
    const { result } = setup();
    act(() => result.current.select(1));
    act(() => result.current.togglePlacing());
    expect(result.current.placing).toBe(true);

    let used = false;
    act(() => void (used = result.current.onKeyDown(key({ key: "Escape" }))));

    expect(used).toBe(true);
    expect(result.current.placing).toBe(false);
    expect(result.current.selectedId).toBeNull();
    expect(result.current.onKeyDown(key({ key: "Escape" }))).toBe(false);
  });
});

describe("selecting a mark by clicking it", () => {
  beforeEach(() => {
    showMarks([mark({ id: 4, page: 2, rects: [[100, 600, 200, 612]] })]);
  });

  it("selects the mark under the click, and none when the click is beside it", () => {
    pages = [buildPage(1, "x", "0,0,1,1"), buildPage(2, "x", "0,0,1,1"), buildPage(3, "x", "0,0,1,1")];
    const { result } = setup();

    // (100..200, 600..612) in raw space is (100..200, 180..192) on the screen
    act(() => result.current.onContainerClick(clickAt(pages[2].element, 150, 186)));
    expect(result.current.selectedId).toBe(4);

    act(() => result.current.onContainerClick(clickAt(pages[2].element, 150, 300)));
    expect(result.current.selectedId).toBeNull();
  });

  it("does not select a mark on another page", () => {
    pages = [buildPage(1, "x", "0,0,1,1"), buildPage(2, "x", "0,0,1,1"), buildPage(3, "x", "0,0,1,1")];
    const { result } = setup();

    act(() => result.current.onContainerClick(clickAt(pages[0].element, 150, 186)));

    expect(result.current.selectedId).toBeNull();
  });

  it("lets go of the selection when the click is outside every page", () => {
    pages = [buildPage(3, "x", "0,0,1,1")];
    const { result } = setup();
    act(() => result.current.select(4));

    act(() => result.current.onContainerClick(clickAt(host, 5, 5)));

    expect(result.current.selectedId).toBeNull();
  });

  it("leaves a click that ends a text selection to the selection", () => {
    pages = [buildPage(3, "some words here", "100,180,200,192")];
    const { result } = setup();
    selectText(pages[0]);

    act(() => result.current.onContainerClick(clickAt(pages[0].element, 150, 186)));

    expect(result.current.selectedId).toBeNull();
  });

  it("does not select while a text note is being placed", () => {
    pages = [buildPage(3, "x", "0,0,1,1")];
    const { result } = setup();
    act(() => result.current.togglePlacing());

    act(() => result.current.onContainerClick(clickAt(pages[0].element, 150, 186)));

    expect(result.current.selectedId).toBeNull();
  });
});

describe("changing a mark", () => {
  it("recolors a mark, and remembers the color; the same color is not saved again", async () => {
    const m = mark();
    const { store, result } = setup();

    await act(async () => void result.current.layerHandlers.onRecolor(m, "blue"));
    await act(async () => void result.current.layerHandlers.onRecolor(m, "yellow"));

    expect(store.changeMark).toHaveBeenCalledTimes(1);
    expect(store.changeMark).toHaveBeenCalledWith(m, { color: "blue" });
    expect(result.current.color).toBe("yellow");
  });

  it("saves a comment", async () => {
    const m = mark();
    const { store, result } = setup();

    await act(async () => void result.current.layerHandlers.onComment(m, "check this"));

    expect(store.changeMark).toHaveBeenCalledWith(m, { comment: "check this" });
  });

  it("deletes a mark from the popover", async () => {
    const m = mark();
    const { store, result } = setup();

    await act(async () => void result.current.layerHandlers.onDelete(m));

    expect(store.removeMark).toHaveBeenCalledWith(m);
  });
});

describe("text notes", () => {
  const rect: [number, number, number, number] = [50, 500, 250, 556];

  it("places a note where the page was clicked, then saves it with its words in the chosen color", async () => {
    const { store, result } = setup();
    act(() => result.current.togglePlacing());
    act(() => result.current.layerHandlers.onPlace(5, rect));

    expect(result.current.placing).toBe(false);
    expect(result.current.draft).toEqual({ page: 5, rect });

    await act(async () => void result.current.layerHandlers.onCommitDraft("Check this against chapter two"));

    expect(store.addMarks).toHaveBeenCalledWith(7, [{ page: 5, kind: "text", color: "yellow", body: { rect, text: "Check this against chapter two", fontSize: 12 } }]);
    expect(result.current.draft).toBeNull();
  });

  it("keeps nothing when the words are only spaces, or the draft is cancelled", async () => {
    const { store, result } = setup();
    act(() => result.current.layerHandlers.onPlace(5, rect));
    await act(async () => void result.current.layerHandlers.onCommitDraft("   "));
    act(() => result.current.layerHandlers.onPlace(5, rect));
    act(() => result.current.layerHandlers.onCancelDraft());

    expect(store.addMarks).not.toHaveBeenCalled();
    expect(result.current.draft).toBeNull();
  });

  it("retypes a note: the edit is open until it is committed, and only changed words are saved", async () => {
    const note = mark({ id: 9, kind: "text", rects: null, quote: "", body: { rect, text: "old words", fontSize: 12 } });
    const { store, result } = setup();

    act(() => result.current.layerHandlers.onEdit(9));
    expect(result.current.editingId).toBe(9);
    await act(async () => void result.current.layerHandlers.onCommitEdit(note, "old words"));
    expect(result.current.editingId).toBeNull();
    expect(store.changeMark).not.toHaveBeenCalled();

    act(() => result.current.layerHandlers.onEdit(9));
    await act(async () => void result.current.layerHandlers.onCommitEdit(note, "new words"));

    expect(store.changeMark).toHaveBeenCalledWith(note, { body: { rect, text: "new words", fontSize: 12 } });
  });

  it("deletes a note whose words were all removed", async () => {
    const note = mark({ id: 9, kind: "text", rects: null, quote: "", body: { rect, text: "old words" } });
    const { store, result } = setup();

    await act(async () => void result.current.layerHandlers.onCommitEdit(note, "  "));

    expect(store.removeMark).toHaveBeenCalledWith(note);
    expect(store.changeMark).not.toHaveBeenCalled();
  });

  it("toggles placing, and clears the selected mark when it starts", () => {
    const { result } = setup();
    act(() => result.current.select(1));

    act(() => result.current.togglePlacing());
    expect(result.current.placing).toBe(true);
    expect(result.current.selectedId).toBeNull();

    act(() => result.current.togglePlacing());
    expect(result.current.placing).toBe(false);
  });
});

describe("undo and redo buttons", () => {
  it("ask the store, and show why when it cannot", async () => {
    const store = fakeStore({ redoMark: vi.fn(async () => ({ error: "Nothing to redo." })) });
    const { result } = setup(store);

    act(() => result.current.undo());
    act(() => result.current.redo());

    await waitFor(() => expect(result.current.error).toBe("Nothing to redo."));
    expect(store.undoMark).toHaveBeenCalledWith(7);
  });
});
