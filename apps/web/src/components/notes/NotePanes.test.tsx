// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteNote, moveNoteToGroup, saveNoteContent } from "@/lib/composition/client";
import { DEFAULT_LAYOUT } from "@/lib/composition/layout";
import { GROUP_DRAG_TYPE, NOTE_DRAG_TYPE, PANE_DRAG_TYPE } from "./dragTypes";
import { NotesApp } from "./NotesApp";
import type { Group, Note } from "./types";

vi.mock("@/lib/composition/client", () => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  deleteGroup: vi.fn(),
  deleteNote: vi.fn(),
  moveGroup: vi.fn(),
  moveNoteToGroup: vi.fn(),
  renameGroup: vi.fn(),
  saveLayout: vi.fn(),
  saveNoteContent: vi.fn(),
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

const at = "2026-01-01T00:00:00.000Z";
const makeNote = (id: number, title: string, groupId: number | null = null): Note => ({
  id,
  title,
  content: `body of ${title}`,
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId,
});

const notes = [makeNote(1, "Alpha"), makeNote(2, "Beta"), makeNote(3, "Gamma")];
const group: Group = { id: 9, name: "Work", parentId: null, createdAt: at, updatedAt: at };

function renderApp(initialNotes: Note[] = notes, groups: Group[] = []) {
  render(<NotesApp initialNotes={initialNotes} initialGroups={groups} initialLayout={DEFAULT_LAYOUT} />);
}

/** A minimal DataTransfer stand-in: jsdom has none. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return [...data.keys()];
    },
    effectAllowed: "all",
    dropEffect: "none",
  };
}
type Transfer = ReturnType<typeof dataTransfer>;

const pane = (title: string) => screen.getByRole("region", { name: title });
const paneTitles = () => screen.getAllByRole("region").map((p) => p.getAttribute("aria-label"));
const sidebarRow = (title: string) =>
  within(screen.getByRole("navigation", { name: "Notes" })).getByRole("button", { name: title });
const editorIn = (title: string) => within(pane(title)).getByLabelText<HTMLTextAreaElement>("Markdown editor");

/** jsdom lays nothing out, so give a pane the 1000px-wide box that the drop zones are read from. */
function sizePane(title: string, left = 0, width = 1000) {
  vi.spyOn(pane(title), "getBoundingClientRect").mockReturnValue({
    left,
    right: left + width,
    top: 0,
    bottom: 600,
    width,
    height: 600,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
}

/** Fires a drag event at `target` with the pointer at `x` (and a y inside any sized pane). */
function drag(kind: "dragEnter" | "dragOver" | "dragLeave" | "drop", target: Element, dt: Transfer, x = 500, y = 10) {
  const event = createEvent[kind](target, { dataTransfer: dt });
  Object.defineProperty(event, "clientX", { value: x });
  Object.defineProperty(event, "clientY", { value: y });
  return fireEvent(target, event);
}

/** Starts dragging a note out of the sidebar. */
function dragFromSidebar(title: string, noteId: number): Transfer {
  const dt = dataTransfer();
  fireEvent.dragStart(sidebarRow(title), { dataTransfer: dt });
  expect(dt.getData(NOTE_DRAG_TYPE)).toBe(String(noteId));
  return dt;
}

/** Starts dragging an open note by its pane header. */
function dragFromHeader(title: string): Transfer {
  const dt = dataTransfer();
  fireEvent.dragStart(pane(title).querySelector("header")!, { dataTransfer: dt });
  return dt;
}

/** Opens Alpha and Beta side by side by dropping Beta on Alpha's right edge; Beta, just dropped, is focused. */
function openAlphaBesideBeta() {
  renderApp();
  sizePane("Alpha");
  const dt = dragFromSidebar("Beta", 2);
  drag("dragOver", pane("Alpha"), dt, 900);
  drag("drop", pane("Alpha"), dt, 900);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("opening notes beside each other", () => {
  it("starts with one pane, showing the first note", () => {
    renderApp();

    expect(paneTitles()).toEqual(["Alpha"]);
    expect(editorIn("Alpha").value).toBe("body of Alpha");
  });

  it("opens a note dragged from the sidebar to the right edge in a new pane beside the first", () => {
    openAlphaBesideBeta();

    expect(paneTitles()).toEqual(["Alpha", "Beta"]);
    expect(editorIn("Alpha").value).toBe("body of Alpha");
    expect(editorIn("Beta").value).toBe("body of Beta");
  });

  it("opens a note dragged to the left edge before the pane", () => {
    renderApp();
    sizePane("Alpha");
    const dt = dragFromSidebar("Beta", 2);

    drag("drop", pane("Alpha"), dt, 50);

    expect(paneTitles()).toEqual(["Beta", "Alpha"]);
  });

  it("keeps editor and preview side by side inside every pane", () => {
    openAlphaBesideBeta();

    for (const title of ["Alpha", "Beta"]) {
      const scope = within(pane(title));
      expect(scope.getByRole("tabpanel", { name: "Markdown" })).toBeTruthy();
      expect(scope.getByRole("tabpanel", { name: "Preview" })).toBeTruthy();
      expect(scope.getByRole("tab", { name: "Split" }).getAttribute("aria-selected")).toBe("true");
      expect(scope.getByRole("separator", { name: "Resize editor and preview" })).toBeTruthy();
    }
  });

  it("replaces the pane's note when the drop lands in its middle", () => {
    renderApp();
    sizePane("Alpha");
    const dt = dragFromSidebar("Beta", 2);

    drag("drop", pane("Alpha"), dt, 500);

    expect(paneTitles()).toEqual(["Beta"]);
  });

  it("can split a third pane out of either neighbour", () => {
    openAlphaBesideBeta();
    sizePane("Beta");
    const dt = dragFromSidebar("Gamma", 3);

    drag("drop", pane("Beta"), dt, 50);

    expect(paneTitles()).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("moves an already open note rather than opening it twice", () => {
    openAlphaBesideBeta();
    sizePane("Beta");
    const dt = dragFromSidebar("Alpha", 1);

    drag("drop", pane("Beta"), dt, 950);

    expect(paneTitles()).toEqual(["Beta", "Alpha"]);
  });

  it("opens a note dragged into the empty workspace", () => {
    renderApp();
    fireEvent.click(within(pane("Alpha")).getByRole("button", { name: "Close Alpha" }));
    expect(screen.queryAllByRole("region")).toHaveLength(0);

    const dt = dragFromSidebar("Beta", 2);
    const empty = screen.getByText(/No note is open/).closest("[data-slot=empty]")!.parentElement!;
    drag("dragOver", empty, dt);
    expect(empty.querySelector("[data-drop-zone=center]")).not.toBeNull();
    drag("drop", empty, dt);

    expect(paneTitles()).toEqual(["Beta"]);
  });
});

describe("rearranging panes", () => {
  it("moves a pane when its header is dropped on another pane's edge", () => {
    openAlphaBesideBeta();
    sizePane("Alpha");
    const dt = dragFromHeader("Beta");

    drag("drop", pane("Alpha"), dt, 50);

    expect(paneTitles()).toEqual(["Beta", "Alpha"]);
  });

  it("swaps two panes when a header is dropped on the other pane's middle", () => {
    openAlphaBesideBeta();
    sizePane("Beta");
    const dt = dragFromHeader("Alpha");

    drag("drop", pane("Beta"), dt, 500);

    expect(paneTitles()).toEqual(["Beta", "Alpha"]);
  });

  it("does nothing when a pane is dropped on itself", () => {
    openAlphaBesideBeta();
    sizePane("Alpha");
    const dt = dragFromHeader("Alpha");

    drag("drop", pane("Alpha"), dt, 50);
    drag("drop", pane("Alpha"), dt, 500);

    expect(paneTitles()).toEqual(["Alpha", "Beta"]);
  });

  it("is not mistaken for a drag to a sidebar group, which would file the note there", () => {
    renderApp([makeNote(1, "Alpha", 9)], [group]);
    const dt = dragFromHeader("Alpha");
    const groupRow = screen.getByTitle("View all notes in Work").closest("[draggable]")!;

    // true = default not prevented = the group refused the drop.
    expect(drag("dragOver", groupRow, dt)).toBe(true);
    drag("drop", groupRow, dt);

    expect(moveNoteToGroup).not.toHaveBeenCalled();
  });

  it("still files a note dragged from the sidebar into a group", () => {
    renderApp([makeNote(1, "Alpha")], [group]);
    vi.mocked(moveNoteToGroup).mockResolvedValue(makeNote(1, "Alpha", 9));
    const dt = dragFromSidebar("Alpha", 1);
    const groupRow = screen.getByTitle("View all notes in Work").closest("[draggable]")!;

    drag("dragOver", groupRow, dt);
    drag("drop", groupRow, dt);

    expect(moveNoteToGroup).toHaveBeenCalledWith(1, 9);
  });

  it("resizes the two panes beside a divider", () => {
    openAlphaBesideBeta();
    const handle = screen.getByRole("separator", { name: "Resize panes 1 and 2" });
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue({ width: 1000 } as DOMRect);
    const flexOf = (title: string) => Number.parseFloat(pane(title).style.flex);
    // Splitting Alpha gave each half of its width.
    expect(flexOf("Alpha")).toBeCloseTo(0.5);
    expect(flexOf("Beta")).toBeCloseTo(0.5);

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });

    expect(flexOf("Alpha")).toBeCloseTo(0.6);
    expect(flexOf("Beta")).toBeCloseTo(0.4);
    expect(pane("Alpha").style.minWidth).toBe("240px");
  });
});

describe("the drop indicator", () => {
  it("shows the half of the pane the new pane would take, and follows the pointer", () => {
    renderApp();
    sizePane("Alpha");
    const dt = dragFromSidebar("Beta", 2);
    const zone = () => pane("Alpha").querySelector("[data-drop-zone]")?.getAttribute("data-drop-zone") ?? null;
    expect(zone()).toBeNull();

    drag("dragOver", pane("Alpha"), dt, 50);
    expect(zone()).toBe("left");
    drag("dragOver", pane("Alpha"), dt, 500);
    expect(zone()).toBe("center");
    drag("dragOver", pane("Alpha"), dt, 950);
    expect(zone()).toBe("right");
  });

  it("goes away when the drag leaves the pane, but not when it moves onto something inside it", () => {
    renderApp();
    sizePane("Alpha");
    const dt = dragFromSidebar("Beta", 2);
    drag("dragOver", pane("Alpha"), dt, 500);

    drag("dragLeave", editorIn("Alpha"), dt, 500);
    expect(pane("Alpha").querySelector("[data-drop-zone]")).not.toBeNull();

    drag("dragLeave", pane("Alpha"), dt, 1200);
    expect(pane("Alpha").querySelector("[data-drop-zone]")).toBeNull();
  });

  it.each([["moves", fireEvent.pointerMove], ["is pressed", fireEvent.pointerDown]] as const)(
    "goes away if the drag is cancelled and the pointer %s again",
    (_label, pointer) => {
      renderApp();
      sizePane("Alpha");
      drag("dragOver", pane("Alpha"), dragFromSidebar("Beta", 2), 500);
      expect(pane("Alpha").querySelector("[data-drop-zone]")).not.toBeNull();

      pointer(pane("Alpha"));

      expect(pane("Alpha").querySelector("[data-drop-zone]")).toBeNull();
    },
  );

  it("does not offer a drop for a group or for anything that isn't a note", () => {
    renderApp();
    sizePane("Alpha");
    const groupDrag = dataTransfer();
    groupDrag.setData(GROUP_DRAG_TYPE, "9");
    const fileDrag = dataTransfer();
    fileDrag.setData("Files", "");

    // true = default not prevented = the drop is refused.
    expect(drag("dragOver", pane("Alpha"), groupDrag)).toBe(true);
    expect(drag("dragOver", pane("Alpha"), fileDrag)).toBe(true);
    expect(pane("Alpha").querySelector("[data-drop-zone]")).toBeNull();
  });

  it("accepts the drop as soon as the drag enters, before any dragover", () => {
    renderApp();
    sizePane("Alpha");
    const dt = dragFromSidebar("Beta", 2);

    // false = default prevented = the drop is allowed.
    expect(drag("dragEnter", pane("Alpha"), dt, 950)).toBe(false);
    drag("drop", pane("Alpha"), dt, 950);

    expect(paneTitles()).toEqual(["Alpha", "Beta"]);
  });

  it("accepts a note dragged by a pane header too", () => {
    openAlphaBesideBeta();
    sizePane("Alpha");
    const dt = dataTransfer();
    dt.setData(PANE_DRAG_TYPE, "2");

    expect(drag("dragOver", pane("Alpha"), dt)).toBe(false);
  });
});

describe("focus, closing and deleting", () => {
  it("marks the pane being worked in, and moves the mark as the user switches pane", () => {
    openAlphaBesideBeta();
    expect(pane("Beta").getAttribute("aria-current")).toBe("true");
    expect(pane("Alpha").getAttribute("aria-current")).toBeNull();

    fireEvent.pointerDown(pane("Alpha"));

    expect(pane("Alpha").getAttribute("aria-current")).toBe("true");
    expect(pane("Beta").getAttribute("aria-current")).toBeNull();
  });

  it("opens a note picked in the sidebar into the focused pane only", () => {
    openAlphaBesideBeta();
    fireEvent.pointerDown(pane("Beta"));

    fireEvent.click(sidebarRow("Gamma"));

    expect(paneTitles()).toEqual(["Alpha", "Gamma"]);
  });

  it("focuses the pane of a note that is already open rather than opening it again", () => {
    openAlphaBesideBeta();
    fireEvent.pointerDown(pane("Beta"));

    fireEvent.click(sidebarRow("Alpha"));

    expect(paneTitles()).toEqual(["Alpha", "Beta"]);
    expect(pane("Alpha").getAttribute("aria-current")).toBe("true");
  });

  it("highlights the focused pane's note in the sidebar", () => {
    openAlphaBesideBeta();
    expect(sidebarRow("Beta").getAttribute("aria-current")).toBe("true");

    fireEvent.pointerDown(pane("Alpha"));

    expect(sidebarRow("Alpha").getAttribute("aria-current")).toBe("true");
    expect(sidebarRow("Beta").getAttribute("aria-current")).toBeNull();
  });

  it("closes a pane from its header without deleting the note", () => {
    openAlphaBesideBeta();

    fireEvent.click(within(pane("Alpha")).getByRole("button", { name: "Close Alpha" }));

    expect(paneTitles()).toEqual(["Beta"]);
    expect(deleteNote).not.toHaveBeenCalled();
    expect(sidebarRow("Alpha")).toBeTruthy();
  });

  it("offers to open a note once every pane is closed, and keeps the new-note button", () => {
    renderApp();

    fireEvent.click(within(pane("Alpha")).getByRole("button", { name: "Close Alpha" }));

    expect(screen.getByText(/No note is open/)).toBeTruthy();
    expect(screen.getAllByText("+ New note").length).toBeGreaterThan(1);
  });

  it("closes the pane of a deleted note, once the deletion is confirmed", () => {
    openAlphaBesideBeta();

    fireEvent.click(screen.getByRole("button", { name: "Delete Beta" }));
    expect(deleteNote).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    expect(paneTitles()).toEqual(["Alpha"]);
    expect(deleteNote).toHaveBeenCalledWith(2);
  });

  it("brings the panes back after visiting a group page", () => {
    renderApp([makeNote(1, "Alpha", 9), makeNote(2, "Beta", 9)], [group]);
    sizePane("Alpha");
    const dt = dragFromSidebar("Beta", 2);
    drag("drop", pane("Alpha"), dt, 900);
    expect(paneTitles()).toEqual(["Alpha", "Beta"]);

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Beta" }));

    expect(paneTitles()).toEqual(["Alpha", "Beta"]);
  });
});

describe("saving with several panes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveNoteContent).mockImplementation(async (id, content) => ({
      ...notes.find((n) => n.id === id)!,
      content,
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("saves edits made in two panes to their own notes", async () => {
    openAlphaBesideBeta();

    fireEvent.change(editorIn("Alpha"), { target: { value: "alpha edited" } });
    await advance(100);
    fireEvent.change(editorIn("Beta"), { target: { value: "beta edited" } });
    await advance(500);

    expect(saveNoteContent).toHaveBeenCalledWith(1, "alpha edited");
    expect(saveNoteContent).toHaveBeenCalledWith(2, "beta edited");
    expect(saveNoteContent).toHaveBeenCalledTimes(2);
  });

  it("does not drop one pane's unsaved edit when another pane is edited straight after", async () => {
    openAlphaBesideBeta();

    fireEvent.change(editorIn("Alpha"), { target: { value: "alpha edited" } });
    fireEvent.change(editorIn("Beta"), { target: { value: "beta edited" } });
    await advance(500);

    expect(saveNoteContent).toHaveBeenCalledWith(1, "alpha edited");
    expect(saveNoteContent).toHaveBeenCalledWith(2, "beta edited");
  });

  it("saves only the latest text of a pane that was typed in repeatedly", async () => {
    openAlphaBesideBeta();

    fireEvent.change(editorIn("Alpha"), { target: { value: "a" } });
    await advance(300);
    fireEvent.change(editorIn("Alpha"), { target: { value: "ab" } });
    await advance(500);

    expect(saveNoteContent).toHaveBeenCalledTimes(1);
    expect(saveNoteContent).toHaveBeenCalledWith(1, "ab");
  });

  it("does not save an edit to a note that was deleted before the debounce ran out", async () => {
    openAlphaBesideBeta();

    fireEvent.change(editorIn("Beta"), { target: { value: "beta edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Beta" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await advance(1000);

    expect(saveNoteContent).not.toHaveBeenCalled();
  });

  it("shows a note's edits in the sidebar title live in the pane it is open in", async () => {
    openAlphaBesideBeta();

    fireEvent.change(editorIn("Alpha"), { target: { value: "alpha edited" } });
    await advance(500);

    expect(editorIn("Alpha").value).toBe("alpha edited");
    expect(editorIn("Beta").value).toBe("body of Beta");
  });
});

describe("viewing a note as tabs", () => {
  const tab = (title: string, name: string) => within(pane(title)).getByRole("tab", { name });
  const selected = (title: string) =>
    within(pane(title))
      .getAllByRole("tab")
      .filter((el) => el.getAttribute("aria-selected") === "true")
      .map((el) => el.textContent);
  const panel = (title: string, name: string) => within(pane(title)).queryByRole("tabpanel", { name });
  /** Reads the preview panel itself, hidden or not: the editor's textarea holds the same words. */
  const previewHas = (title: string, text: string) =>
    pane(title).querySelector('[role="tabpanel"][id$="-panel-preview"]')?.textContent?.includes(text) ?? false;

  /** The tab strip's width tracking needs ResizeObserver, which jsdom lacks; this one is told widths by hand. */
  const observed = new Map<Element, ResizeObserverCallback>();
  class FakeResizeObserver {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) {
      observed.set(element, this.callback);
    }
    unobserve() {}
    disconnect() {}
  }
  function resizePane(title: string, width: number) {
    const element = pane(title);
    act(() => {
      observed.get(element)!([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    });
  }

  beforeEach(() => vi.stubGlobal("ResizeObserver", FakeResizeObserver));
  afterEach(() => {
    vi.unstubAllGlobals();
    observed.clear();
  });

  it("offers the editor, the preview and both, starting with both", () => {
    renderApp();

    expect(within(pane("Alpha")).getAllByRole("tab").map((el) => el.textContent)).toEqual([
      "Markdown",
      "Preview",
      "Split",
    ]);
    expect(selected("Alpha")).toEqual(["Split"]);
    expect(panel("Alpha", "Markdown")).not.toBeNull();
    expect(panel("Alpha", "Preview")).not.toBeNull();
  });

  it("shows just the editor on the Markdown tab", () => {
    renderApp();

    fireEvent.click(tab("Alpha", "Markdown"));

    expect(selected("Alpha")).toEqual(["Markdown"]);
    expect(panel("Alpha", "Markdown")).not.toBeNull();
    expect(panel("Alpha", "Preview")).toBeNull();
    expect(within(pane("Alpha")).queryByRole("separator", { name: "Resize editor and preview" })).toBeNull();
    expect(previewHas("Alpha", "body of Alpha")).toBe(false);
  });

  it("shows just the preview on the Preview tab, keeping the editor mounted behind it", () => {
    renderApp();
    const editor = editorIn("Alpha");

    fireEvent.click(tab("Alpha", "Preview"));

    expect(selected("Alpha")).toEqual(["Preview"]);
    expect(panel("Alpha", "Markdown")).toBeNull();
    expect(previewHas("Alpha", "body of Alpha")).toBe(true);
    // Still there, so its caret and undo history survive a look at the preview.
    expect(editorIn("Alpha")).toBe(editor);
    expect(editor.closest("[role=tabpanel]")!.hasAttribute("hidden")).toBe(true);
  });

  it("brings both back on the Split tab", () => {
    renderApp();
    fireEvent.click(tab("Alpha", "Preview"));

    fireEvent.click(tab("Alpha", "Split"));

    expect(panel("Alpha", "Markdown")).not.toBeNull();
    expect(panel("Alpha", "Preview")).not.toBeNull();
    expect(selected("Alpha")).toEqual(["Split"]);
  });

  it("chooses the view for each note's pane on its own", () => {
    openAlphaBesideBeta();

    fireEvent.click(tab("Alpha", "Preview"));
    fireEvent.click(tab("Beta", "Markdown"));

    expect(selected("Alpha")).toEqual(["Preview"]);
    expect(selected("Beta")).toEqual(["Markdown"]);
  });

  it("shows what was typed on the Markdown tab when switching to the Preview tab", () => {
    renderApp();
    fireEvent.click(tab("Alpha", "Markdown"));

    fireEvent.change(editorIn("Alpha"), { target: { value: "typed words" } });
    fireEvent.click(tab("Alpha", "Preview"));

    expect(previewHas("Alpha", "typed words")).toBe(true);
    expect(editorIn("Alpha").value).toBe("typed words");
  });

  it("keeps the typed text and focus on the editor across a switch of tab", () => {
    renderApp();
    const editor = editorIn("Alpha");
    editor.focus();
    fireEvent.change(editor, { target: { value: "draft" } });
    editor.setSelectionRange(2, 2);

    fireEvent.click(tab("Alpha", "Preview"));
    fireEvent.click(tab("Alpha", "Markdown"));

    expect(editorIn("Alpha")).toBe(editor);
    expect(editor.value).toBe("draft");
    expect(editor.selectionStart).toBe(2);
  });

  describe("with the keyboard", () => {
    it("moves between the tabs with the arrow keys, selecting as it goes", () => {
      renderApp();
      fireEvent.click(tab("Alpha", "Markdown"));

      fireEvent.keyDown(tab("Alpha", "Markdown"), { key: "ArrowRight" });
      expect(selected("Alpha")).toEqual(["Preview"]);
      expect(document.activeElement).toBe(tab("Alpha", "Preview"));

      fireEvent.keyDown(tab("Alpha", "Preview"), { key: "ArrowRight" });
      expect(selected("Alpha")).toEqual(["Split"]);

      // Wraps round.
      fireEvent.keyDown(tab("Alpha", "Split"), { key: "ArrowRight" });
      expect(selected("Alpha")).toEqual(["Markdown"]);
      fireEvent.keyDown(tab("Alpha", "Markdown"), { key: "ArrowLeft" });
      expect(selected("Alpha")).toEqual(["Split"]);
    });

    it("jumps to the first and last tab with Home and End", () => {
      renderApp();

      fireEvent.keyDown(tab("Alpha", "Split"), { key: "Home" });
      expect(selected("Alpha")).toEqual(["Markdown"]);
      fireEvent.keyDown(tab("Alpha", "Markdown"), { key: "End" });
      expect(selected("Alpha")).toEqual(["Split"]);
    });

    it("keeps only the selected tab in the tab order", () => {
      renderApp();
      fireEvent.click(tab("Alpha", "Preview"));

      expect(tab("Alpha", "Preview").tabIndex).toBe(0);
      expect(tab("Alpha", "Markdown").tabIndex).toBe(-1);
      expect(tab("Alpha", "Split").tabIndex).toBe(-1);
    });
  });

  describe("in a pane too narrow to put them side by side", () => {
    it("shows the editor tab instead of stacking the preview below it, and offers no Split", () => {
      renderApp();

      resizePane("Alpha", 300);

      expect(within(pane("Alpha")).queryByRole("tab", { name: "Split" })).toBeNull();
      expect(selected("Alpha")).toEqual(["Markdown"]);
      expect(panel("Alpha", "Markdown")).not.toBeNull();
      expect(panel("Alpha", "Preview")).toBeNull();
      expect(previewHas("Alpha", "body of Alpha")).toBe(false);
    });

    it("lets the user switch to the preview and back", () => {
      renderApp();
      resizePane("Alpha", 300);

      fireEvent.click(tab("Alpha", "Preview"));
      expect(selected("Alpha")).toEqual(["Preview"]);
      expect(previewHas("Alpha", "body of Alpha")).toBe(true);

      fireEvent.click(tab("Alpha", "Markdown"));
      expect(selected("Alpha")).toEqual(["Markdown"]);
    });

    it("skips the missing Split tab when moving with the arrow keys", () => {
      renderApp();
      resizePane("Alpha", 300);
      fireEvent.click(tab("Alpha", "Preview"));

      // With Split missing, the tab after Preview is Markdown again.
      fireEvent.keyDown(tab("Alpha", "Preview"), { key: "ArrowRight" });

      expect(selected("Alpha")).toEqual(["Markdown"]);
    });

    it("goes back to side by side when the pane is widened again", () => {
      renderApp();
      resizePane("Alpha", 300);
      resizePane("Alpha", 700);

      expect(selected("Alpha")).toEqual(["Split"]);
      expect(panel("Alpha", "Preview")).not.toBeNull();
    });

    it("keeps a chosen single view however wide the pane gets", () => {
      renderApp();
      fireEvent.click(tab("Alpha", "Preview"));

      resizePane("Alpha", 300);
      expect(selected("Alpha")).toEqual(["Preview"]);
      resizePane("Alpha", 700);
      expect(selected("Alpha")).toEqual(["Preview"]);
    });

    it("only narrows the pane that is narrow", () => {
      openAlphaBesideBeta();

      resizePane("Alpha", 300);

      expect(selected("Alpha")).toEqual(["Markdown"]);
      expect(selected("Beta")).toEqual(["Split"]);
    });

    it("measures widths as the dividers are dragged", () => {
      openAlphaBesideBeta();

      resizePane("Beta", 479);
      expect(within(pane("Beta")).queryByRole("tab", { name: "Split" })).toBeNull();
      resizePane("Beta", 480);
      expect(within(pane("Beta")).queryByRole("tab", { name: "Split" })).not.toBeNull();
    });
  });

  describe("when notes move between panes", () => {
    it("keeps a pane's view when another note is opened in it", () => {
      openAlphaBesideBeta();
      fireEvent.click(tab("Beta", "Preview"));

      fireEvent.click(sidebarRow("Gamma"));

      expect(paneTitles()).toEqual(["Alpha", "Gamma"]);
      expect(selected("Gamma")).toEqual(["Preview"]);
    });

    it("starts a note opened in a new pane side by side", () => {
      openAlphaBesideBeta();
      fireEvent.click(tab("Alpha", "Preview"));
      sizePane("Alpha");

      drag("drop", pane("Alpha"), dragFromSidebar("Gamma", 3), 950);

      expect(selected("Gamma")).toEqual(["Split"]);
    });

    it("sends each note's view along with it when two panes swap", () => {
      openAlphaBesideBeta();
      fireEvent.click(tab("Alpha", "Preview"));
      fireEvent.click(tab("Beta", "Markdown"));
      sizePane("Beta");

      drag("drop", pane("Beta"), dragFromHeader("Alpha"), 500);

      expect(paneTitles()).toEqual(["Beta", "Alpha"]);
      expect(selected("Alpha")).toEqual(["Preview"]);
      expect(selected("Beta")).toEqual(["Markdown"]);
    });

    it("keeps a moved pane's view", () => {
      openAlphaBesideBeta();
      fireEvent.click(tab("Alpha", "Preview"));
      sizePane("Beta");

      drag("drop", pane("Beta"), dragFromHeader("Alpha"), 950);

      expect(paneTitles()).toEqual(["Beta", "Alpha"]);
      expect(selected("Alpha")).toEqual(["Preview"]);
    });
  });
});
