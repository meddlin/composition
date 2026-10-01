// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createNote, deleteGroup, deleteNote, moveGroup, renameGroup, saveFavorites, saveLayout, saveNoteContent } from "@/lib/composition/client";
import type { Favorites } from "@/lib/composition/favorites";
import { DEFAULT_LAYOUT, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "@/lib/composition/layout";
import { NotesApp } from "./NotesApp";
import type { Note } from "./types";

vi.mock("@/lib/composition/client", () => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  deleteGroup: vi.fn(),
  deleteNote: vi.fn(),
  moveGroup: vi.fn(),
  moveNoteToGroup: vi.fn(),
  renameGroup: vi.fn(),
  saveFavorites: vi.fn(),
  saveLayout: vi.fn(),
  saveNoteContent: vi.fn(),
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

const AUTOSAVE_DELAY_MS = 500;

const note: Note = {
  id: 1,
  title: "Hello",
  content: "---\nupdatedAt: old\n---\nhello world",
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
};

// What the server hands back: the same text with its frontmatter re-stamped,
// so it never matches what the user has in the textarea.
const canonical = (content: string): Note => ({
  ...note,
  content: content.replace("updatedAt: old", "updatedAt: new"),
  updatedAt: "2026-02-02T00:00:00.000Z",
});

function renderEditor() {
  render(<NotesApp initialNotes={[note]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);
  return screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("NotesApp autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveNoteContent).mockImplementation(async (_id, content) => canonical(content));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps the caret where it was when the debounced save completes", async () => {
    const editor = renderEditor();
    const typed = `${note.content}, again`;
    const caret = typed.indexOf("world");

    fireEvent.change(editor, { target: { value: typed } });
    editor.setSelectionRange(caret, caret);
    await advance(AUTOSAVE_DELAY_MS);

    expect(saveNoteContent).toHaveBeenCalledWith(1, typed);
    expect(editor.selectionStart).toBe(caret);
    expect(editor.selectionEnd).toBe(caret);
    expect(editor.value).toBe(typed);
  });

  it("still applies the saved metadata to the rest of the UI", async () => {
    vi.mocked(saveNoteContent).mockImplementation(async (_id, content) => ({
      ...canonical(content),
      title: "Renamed",
    }));
    const editor = renderEditor();

    fireEvent.change(editor, { target: { value: `${note.content}!` } });
    await advance(AUTOSAVE_DELAY_MS);

    expect(screen.getAllByText("Renamed").length).toBeGreaterThan(0);
  });

  it("does not overwrite text typed while a save is in flight", async () => {
    let finishFirstSave: (saved: Note) => void = () => {};
    vi.mocked(saveNoteContent).mockImplementationOnce(
      () => new Promise<Note>((resolve) => (finishFirstSave = resolve)),
    );
    const editor = renderEditor();
    const first = `${note.content}!`;
    const second = `${first}!!`;

    fireEvent.change(editor, { target: { value: first } });
    await advance(AUTOSAVE_DELAY_MS);
    fireEvent.change(editor, { target: { value: second } });
    await act(async () => finishFirstSave(canonical(first)));

    expect(editor.value).toBe(second);
  });
});

describe("NotesApp column resizing", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sidebar = () => screen.getByRole("navigation", { name: "Notes" });
  const handle = () => screen.getByRole("separator", { name: "Resize sidebar" });

  function drag(from: number, to: number) {
    fireEvent.pointerDown(handle(), { pointerId: 1, button: 0, clientX: from });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: to });
  }

  it("starts at the saved sidebar width", () => {
    render(
      <NotesApp initialNotes={[note]} initialGroups={[]} initialLayout={{ ...DEFAULT_LAYOUT, sidebarWidth: 300 }} />,
    );

    expect(sidebar().style.width).toBe("300px");
  });

  it("resizes the sidebar live and saves once when the drag ends", () => {
    renderEditor();

    drag(100, 160);
    expect(sidebar().style.width).toBe(`${DEFAULT_LAYOUT.sidebarWidth + 60}px`);
    expect(saveLayout).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle(), { pointerId: 1 });
    expect(saveLayout).toHaveBeenCalledTimes(1);
    expect(saveLayout).toHaveBeenCalledWith({
      sidebarWidth: DEFAULT_LAYOUT.sidebarWidth + 60,
      editorRatio: DEFAULT_LAYOUT.editorRatio,
    });
  });

  it("clamps the sidebar to its min and max", () => {
    renderEditor();

    drag(500, 0);
    expect(sidebar().style.width).toBe(`${MIN_SIDEBAR_WIDTH}px`);

    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 5000 });
    expect(sidebar().style.width).toBe(`${MAX_SIDEBAR_WIDTH}px`);
  });

  it("keeps the sidebar handle when no note is open", () => {
    render(<NotesApp initialNotes={[]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);

    drag(100, 140);
    expect(sidebar().style.width).toBe(`${DEFAULT_LAYOUT.sidebarWidth + 40}px`);
  });
});

describe("NotesApp group note creation", () => {
  afterEach(cleanup);

  it("creates a note directly inside the group it was requested from", async () => {
    const group = { id: 7, name: "Work", parentId: null, createdAt: "", updatedAt: "" };
    vi.mocked(createNote).mockResolvedValue({ ...note, id: 2, groupId: 7 });
    render(<NotesApp initialNotes={[]} initialGroups={[group]} initialLayout={DEFAULT_LAYOUT} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("New note in Work"));
    });

    expect(createNote).toHaveBeenCalledWith("Untitled", 7);
  });

  it("creates an ungrouped note from the empty-state button without leaking the click event", async () => {
    vi.mocked(createNote).mockClear();
    vi.mocked(createNote).mockResolvedValue({ ...note, id: 2 });
    render(<NotesApp initialNotes={[]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);

    // Scoped to the empty state: the sidebar has a "+ New note" button of its own.
    const emptyState = screen.getByText("No notes yet.").closest("[data-slot=empty]") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(emptyState).getByText("+ New note"));
    });

    expect(createNote).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledWith("Untitled", null);
  });

  it("keeps the New note / New group buttons below the note tree", () => {
    render(<NotesApp initialNotes={[note]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);

    const tree = screen.getByText("Ungrouped");
    const newNote = screen.getByText("+ New note");
    expect(tree.compareDocumentPosition(newNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("NotesApp group page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const at = "2026-01-01T00:00:00.000Z";
  const groups = [
    { id: 1, name: "Software Dev Docs", parentId: null, createdAt: at, updatedAt: at },
    { id: 2, name: "Backend", parentId: 1, createdAt: at, updatedAt: at },
  ];
  const notes: Note[] = [
    { ...note, id: 1, title: "Top note", groupId: 1 },
    { ...note, id: 2, title: "Nested note", groupId: 2 },
    { ...note, id: 3, title: "Elsewhere", groupId: null },
  ];

  function renderApp() {
    render(<NotesApp initialNotes={notes} initialGroups={groups} initialLayout={DEFAULT_LAYOUT} />);
  }

  it("replaces the editor with a nested listing when a group name is clicked", () => {
    renderApp();
    expect(screen.queryByLabelText("Markdown editor")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Software Dev Docs" }));

    expect(screen.queryByLabelText("Markdown editor")).toBeNull();
    const page = screen.getByRole("main", { name: "Group Software Dev Docs" });
    expect(page.textContent).toContain("Top note");
    expect(page.textContent).toContain("Backend");
    expect(page.textContent).toContain("Nested note");
    expect(page.textContent).not.toContain("Elsewhere");
  });

  it("opens a note in the editor when it is picked from the listing", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Software Dev Docs" }));

    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Nested note" }));

    expect(screen.queryByRole("main", { name: /^Group / })).toBeNull();
    expect(screen.getByLabelText("Markdown editor")).toBeTruthy();
  });

  it("navigates into a sub-group from the listing", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Software Dev Docs" }));

    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: /Backend/ }));

    expect(screen.getByRole("main", { name: "Group Backend" })).toBeTruthy();
  });
  describe("renaming", () => {
    function openRenameField() {
      renderApp();
      fireEvent.click(screen.getByRole("button", { name: "Software Dev Docs" }));
      fireEvent.click(screen.getByRole("button", { name: "Rename Software Dev Docs" }));
      return screen.getByLabelText<HTMLInputElement>("Group name");
    }

    beforeEach(() => {
      vi.mocked(renameGroup).mockImplementation(async (id, name) => ({
        ...groups.find((g) => g.id === id)!,
        name,
      }));
    });

    it("renames a group from its page and updates the sidebar", async () => {
      const input = openRenameField();
      expect(input.value).toBe("Software Dev Docs");

      fireEvent.change(input, { target: { value: "  Engineering  " } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(renameGroup).toHaveBeenCalledTimes(1);
      expect(renameGroup).toHaveBeenCalledWith(1, "Engineering");
      expect(screen.getByRole("main", { name: "Group Engineering" })).toBeTruthy();
      expect(
        within(screen.getByRole("navigation", { name: "Notes" })).getByRole("button", {
          name: "Engineering",
        }),
      ).toBeTruthy();
    });

    it("renames a sub-group from its own page", async () => {
      renderApp();
      fireEvent.click(screen.getByRole("button", { name: "Software Dev Docs" }));
      fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: /Backend/ }));
      fireEvent.click(screen.getByRole("button", { name: "Rename Backend" }));

      const input = screen.getByLabelText("Group name");
      fireEvent.change(input, { target: { value: "Services" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(renameGroup).toHaveBeenCalledWith(2, "Services");
    });

    it("discards the edit on Escape, even if the field then blurs", () => {
      const input = openRenameField();
      fireEvent.change(input, { target: { value: "Nope" } });
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);

      expect(renameGroup).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "Software Dev Docs" })).toBeTruthy();
    });

    it.each([["blank", "   "], ["unchanged", "Software Dev Docs"]])(
      "does not call the server for a %s name",
      (_label, value) => {
        const input = openRenameField();
        fireEvent.change(input, { target: { value } });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(renameGroup).not.toHaveBeenCalled();
        expect(screen.getByRole("heading", { name: "Software Dev Docs" })).toBeTruthy();
      },
    );

    it("saves on blur", async () => {
      const input = openRenameField();
      fireEvent.change(input, { target: { value: "Docs" } });
      await act(async () => {
        fireEvent.blur(input);
      });

      expect(renameGroup).toHaveBeenCalledWith(1, "Docs");
    });
  });
});

describe("NotesApp group row menu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const at = "2026-01-01T00:00:00.000Z";
  const groups = [
    { id: 1, name: "Work", parentId: null, createdAt: at, updatedAt: at },
    { id: 2, name: "Empty", parentId: null, createdAt: at, updatedAt: at },
  ];
  const notes: Note[] = [{ ...note, id: 1, groupId: 1 }];

  function renderApp() {
    render(<NotesApp initialNotes={notes} initialGroups={groups} initialLayout={DEFAULT_LAYOUT} />);
  }

  const trigger = (name: string) => screen.getByRole("button", { name: `Actions for ${name}` });

  /** Radix opens its menu on a left-button pointerdown, not on click. */
  function openMenu(name: string) {
    fireEvent.pointerDown(trigger(name), { button: 0, ctrlKey: false });
    return screen.getByRole("menu");
  }

  /** Lets timers Radix schedules on open and close (outside-click arming, focus return) run. */
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  it("replaces the per-row + group and delete buttons with a single menu", () => {
    renderApp();

    expect(screen.queryByLabelText("New sub-group inside Work")).toBeNull();
    expect(screen.queryByLabelText("Delete Work")).toBeNull();
    expect(screen.getByLabelText("New note in Work")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actions for Work" })).toBeTruthy();
  });

  it("still renames a group on double-click", async () => {
    vi.mocked(renameGroup).mockResolvedValue({ ...groups[0], name: "Jobs" });
    renderApp();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Work" }));
    const input = screen.getByDisplayValue("Work");
    fireEvent.change(input, { target: { value: "Jobs" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(renameGroup).toHaveBeenCalledWith(1, "Jobs");
  });

  it("does not start a rename when the menu button is double-clicked", () => {
    renderApp();

    fireEvent.doubleClick(trigger("Work"));

    expect(screen.queryByDisplayValue("Work")).toBeNull();
  });

  it("does not start a rename when a menu item is double-clicked", async () => {
    renderApp();

    // Disabled, so the double-click can't also act on the item; it must still not reach the row.
    fireEvent.doubleClick(within(openMenu("Work")).getByRole("menuitem", { name: "Delete group" }));
    await settle();

    expect(screen.queryByDisplayValue("Work")).toBeNull();
  });

  it("renames from the menu", async () => {
    renderApp();

    fireEvent.click(within(openMenu("Work")).getByRole("menuitem", { name: "Rename" }));
    await settle();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByDisplayValue("Work")).toBeTruthy();
  });

  it("creates a sub-group from the menu", async () => {
    vi.mocked(createGroup).mockResolvedValue({ id: 3, name: "Sub", parentId: 1, createdAt: at, updatedAt: at });
    renderApp();

    fireEvent.click(within(openMenu("Work")).getByRole("menuitem", { name: "New sub-group" }));
    const input = screen.getByPlaceholderText("Group name");
    fireEvent.change(input, { target: { value: "Sub" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(createGroup).toHaveBeenCalledWith("Sub", 1);
  });

  it("leaves the new sub-group field focused once the menu has closed", async () => {
    renderApp();

    fireEvent.click(within(openMenu("Work")).getByRole("menuitem", { name: "New sub-group" }));
    await settle();

    // If focus went back to the menu button, the field would blur and cancel itself.
    const input = screen.getByPlaceholderText("Group name");
    expect(document.activeElement).toBe(input);
  });

  it("deletes an empty group from the menu", async () => {
    vi.mocked(deleteGroup).mockResolvedValue({});
    renderApp();

    const item = within(openMenu("Empty")).getByRole("menuitem", { name: "Delete group" });
    await act(async () => {
      fireEvent.click(item);
    });

    expect(deleteGroup).toHaveBeenCalledWith(2);
  });

  it("disables delete for a group that still has notes", async () => {
    renderApp();

    const del = within(openMenu("Work")).getByRole("menuitem", { name: "Delete group" });
    expect(del.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(del);
    await settle();
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("closes on Escape, returning focus to the menu button", async () => {
    renderApp();
    openMenu("Work");

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await settle();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger("Work"));
  });

  it("closes when clicking elsewhere", async () => {
    renderApp();
    openMenu("Work");
    await settle();

    fireEvent.pointerDown(document.body);
    await settle();

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves focus through items with the arrow keys, wrapping past the disabled one", async () => {
    renderApp();
    const menu = openMenu("Work");
    await settle();
    const rename = within(menu).getByRole("menuitem", { name: "Rename" });
    const newSub = within(menu).getByRole("menuitem", { name: "New sub-group" });
    const favorite = within(menu).getByRole("menuitem", { name: "Add to favorites" });

    // Opened by pointer, focus starts on the menu itself; the first arrow enters the items.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement).toBe(rename);

    // Radix moves focus between items on a timer, hence the settling.
    fireEvent.keyDown(rename, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement).toBe(newSub);

    fireEvent.keyDown(newSub, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement).toBe(favorite);

    // Delete is disabled for Work, so the next step wraps back to Rename.
    fireEvent.keyDown(favorite, { key: "ArrowDown" });
    await settle();
    expect(document.activeElement).toBe(rename);
  });
});

describe("NotesApp group drag-and-drop nesting", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const at = "2026-01-01T00:00:00.000Z";
  // Work ─ Projects ─ Alpha, plus a separate top-level Personal.
  const groups = [
    { id: 1, name: "Work", parentId: null, createdAt: at, updatedAt: at },
    { id: 2, name: "Projects", parentId: 1, createdAt: at, updatedAt: at },
    { id: 3, name: "Alpha", parentId: 2, createdAt: at, updatedAt: at },
    { id: 4, name: "Personal", parentId: null, createdAt: at, updatedAt: at },
  ];

  function renderApp() {
    render(<NotesApp initialNotes={[]} initialGroups={groups} initialLayout={DEFAULT_LAYOUT} />);
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
    };
  }

  function rowOf(name: string): HTMLElement {
    const row = screen.getByTitle(`View all notes in ${name}`);
    return row.closest("[draggable]") as HTMLElement;
  }

  /** Drags `from`'s row; returns the shared dataTransfer for subsequent drops. */
  function startDrag(from: string) {
    const dt = dataTransfer();
    fireEvent.dragStart(rowOf(from), { dataTransfer: dt });
    return dt;
  }

  function dropOn(target: HTMLElement, dt: ReturnType<typeof dataTransfer>) {
    fireEvent.dragOver(target, { dataTransfer: dt });
    fireEvent.drop(target, { dataTransfer: dt });
  }

  it("nests a group into another group optimistically and saves it", async () => {
    vi.mocked(moveGroup).mockResolvedValue({ group: { ...groups[3], parentId: 1 } });
    renderApp();

    const dt = startDrag("Personal");
    await act(async () => dropOn(rowOf("Work"), dt));

    expect(moveGroup).toHaveBeenCalledWith(4, 1);
    // Personal now sits inside Work's indented branch instead of at the top level.
    expect(rowOf("Personal").style.paddingLeft).toBe("24px");
  });

  it("does not offer a drop onto the group itself or its descendants", () => {
    renderApp();
    const dt = startDrag("Work");

    for (const name of ["Work", "Projects", "Alpha"]) {
      const target = rowOf(name);
      const notPrevented = fireEvent.dragOver(target, { dataTransfer: dt });
      // fireEvent returns false when preventDefault() was called (drop allowed).
      expect(notPrevented).toBe(true);
      fireEvent.drop(target, { dataTransfer: dt });
    }
    expect(moveGroup).not.toHaveBeenCalled();
  });

  it("moves a nested group back to the top level via the top-level drop zone", async () => {
    vi.mocked(moveGroup).mockResolvedValue({ group: { ...groups[2], parentId: null } });
    renderApp();
    expect(screen.queryByText("Drop here to move to top level")).toBeNull();

    const dt = startDrag("Alpha");
    const zone = screen.getByText("Drop here to move to top level");
    await act(async () => dropOn(zone, dt));

    expect(moveGroup).toHaveBeenCalledWith(3, null);
    expect(screen.queryByText("Drop here to move to top level")).toBeNull();
  });

  it("does not show the top-level zone when dragging an already top-level group", () => {
    renderApp();
    startDrag("Personal");

    expect(screen.queryByText("Drop here to move to top level")).toBeNull();
  });

  it("rolls back and shows the error when the server refuses the move", async () => {
    vi.mocked(moveGroup).mockResolvedValue({ error: "That group can't be moved there." });
    renderApp();

    const dt = startDrag("Personal");
    await act(async () => dropOn(rowOf("Work"), dt));

    expect(screen.getByText("That group can't be moved there.")).toBeTruthy();
    expect(rowOf("Personal").style.paddingLeft).toBe("8px");
  });

  it("does not accept a dragged note on the top-level zone", () => {
    renderApp();
    const dt = dataTransfer();
    dt.setData("application/x-composition-note-id", "1");

    fireEvent.dragStart(rowOf("Alpha"), { dataTransfer: dataTransfer() });
    const zone = screen.getByText("Drop here to move to top level");
    // true = default not prevented = drop refused.
    expect(fireEvent.dragOver(zone, { dataTransfer: dt })).toBe(true);
  });
});

describe("NotesApp favorites", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const at = "2026-01-01T00:00:00.000Z";
  const groups = [
    { id: 1, name: "Work", parentId: null, createdAt: at, updatedAt: at },
    { id: 2, name: "Home", parentId: null, createdAt: at, updatedAt: at },
  ];
  const notes: Note[] = [
    { ...note, id: 1, title: "Plan", groupId: 1 },
    { ...note, id: 2, title: "Groceries", groupId: null },
  ];

  function renderApp(initialFavorites?: Favorites, initialNotes = notes) {
    render(
      <NotesApp
        initialNotes={initialNotes}
        initialGroups={groups}
        initialLayout={DEFAULT_LAYOUT}
        initialFavorites={initialFavorites}
      />,
    );
  }

  const favoritesSection = () => screen.queryByRole("group", { name: "Favorites" });

  /**
   * Radix opens its menu on a left-button pointerdown; the click that picks an item may save.
   * A pinned item also shows in the tree, so `scope` says which copy's menu to use.
   */
  async function chooseAction(trigger: string, item: string, scope: HTMLElement = document.body) {
    fireEvent.pointerDown(within(scope).getByRole("button", { name: `Actions for ${trigger}` }), {
      button: 0,
      ctrlKey: false,
    });
    const menuItem = within(screen.getByRole("menu")).getByRole("menuitem", { name: item });
    await act(async () => {
      fireEvent.click(menuItem);
    });
  }

  it("has no Favorites section until something is pinned", () => {
    renderApp();

    expect(favoritesSection()).toBeNull();
  });

  it("pins a group from its menu and offers to remove it afterwards", async () => {
    renderApp();

    await chooseAction("Work", "Add to favorites");

    expect(within(favoritesSection()!).getByText("Work")).toBeTruthy();
    expect(saveFavorites).toHaveBeenCalledWith([{ type: "group", id: 1 }]);

    // The pinned copy sits above the tree's.
    const [pinnedCopy] = screen.getAllByRole("button", { name: "Actions for Work" });
    fireEvent.pointerDown(pinnedCopy, { button: 0, ctrlKey: false });
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Remove from favorites" })).toBeTruthy();
  });

  it("pins a note from its own menu", async () => {
    renderApp();

    await chooseAction("Groceries", "Add to favorites");

    expect(within(favoritesSection()!).getByText("Groceries")).toBeTruthy();
    expect(saveFavorites).toHaveBeenCalledWith([{ type: "note", id: 2 }]);
  });

  it("lists favorites in the order they were pinned, above the tree", async () => {
    renderApp();

    await chooseAction("Groceries", "Add to favorites");
    await chooseAction("Home", "Add to favorites");

    const section = favoritesSection()!;
    const names = within(section)
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((name) => name && name !== "+ note");
    expect(names).toEqual(["Groceries", "Home"]);
    expect(section.compareDocumentPosition(screen.getByText("Ungrouped")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("unpins from a favorite's menu and drops the section when it was the last", async () => {
    renderApp([{ type: "group", id: 1 }]);

    await chooseAction("Work", "Remove from favorites", favoritesSection()!);

    expect(favoritesSection()).toBeNull();
    expect(saveFavorites).toHaveBeenCalledWith([]);
    // Still in the tree: pinning is a shortcut, not a move.
    expect(screen.getByRole("button", { name: "Actions for Work" })).toBeTruthy();
  });

  it("opens a favorite group's page and a favorite note from the section", async () => {
    renderApp([
      { type: "group", id: 2 },
      { type: "note", id: 2 },
    ]);
    const section = favoritesSection()!;

    fireEvent.click(within(section).getByText("Home"));
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();

    fireEvent.click(within(section).getByText("Groceries"));
    expect(screen.getByLabelText("Markdown editor")).toBeTruthy();
  });

  it("lets a pinned group be expanded to its sub-groups and notes", () => {
    const lawn = [
      { id: 1, name: "Lawn Care", parentId: null, createdAt: at, updatedAt: at },
      { id: 2, name: "Mowing", parentId: 1, createdAt: at, updatedAt: at },
    ];
    const lawnNotes: Note[] = [
      { ...note, id: 1, title: "Fertilizer schedule", groupId: 1 },
      { ...note, id: 2, title: "Blade sharpening", groupId: 2 },
    ];
    render(
      <NotesApp
        initialNotes={lawnNotes}
        initialGroups={lawn}
        initialLayout={DEFAULT_LAYOUT}
        initialFavorites={[{ type: "group", id: 1 }]}
      />,
    );
    const section = favoritesSection()!;

    // Starts collapsed: just the group, not everything under it.
    expect(within(section).queryByText("Fertilizer schedule")).toBeNull();
    expect(within(section).queryByText("Mowing")).toBeNull();

    fireEvent.click(within(section).getByRole("button", { name: "Expand Lawn Care" }));
    expect(within(section).getByText("Fertilizer schedule")).toBeTruthy();
    fireEvent.click(within(section).getByText("Fertilizer schedule"));
    expect(screen.getByLabelText("Markdown editor")).toBeTruthy();

    fireEvent.click(within(section).getByRole("button", { name: "Collapse Mowing" }));
    expect(within(section).queryByText("Blade sharpening")).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Expand Mowing" }));
    expect(within(section).getByText("Blade sharpening")).toBeTruthy();
  });

  it("skips favorites whose group or note no longer exists", () => {
    renderApp([
      { type: "note", id: 99 },
      { type: "group", id: 98 },
    ]);

    expect(favoritesSection()).toBeNull();
  });

  it("never offers to delete a note from the Favorites section", () => {
    renderApp([
      { type: "note", id: 2 },
      { type: "group", id: 1 },
    ]);
    const section = favoritesSection()!;
    fireEvent.click(within(section).getByRole("button", { name: "Expand Work" }));

    // Neither the pinned note nor the note inside the expanded pinned group...
    expect(within(section).getByText("Groceries")).toBeTruthy();
    expect(within(section).getByText("Plan")).toBeTruthy();
    expect(within(section).queryByLabelText(/^Delete /)).toBeNull();
    // ...while the tree below still can.
    expect(screen.getAllByLabelText(/^Delete /).length).toBeGreaterThan(0);
  });

  it("unpins a note when it is deleted", async () => {
    renderApp([
      { type: "note", id: 2 },
      { type: "group", id: 1 },
    ]);

    // The only Delete button for Groceries is the tree's.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete Groceries"));
    });

    expect(deleteNote).toHaveBeenCalledWith(2);
    expect(saveFavorites).toHaveBeenLastCalledWith([{ type: "group", id: 1 }]);
  });

  it("unpins a group when it is deleted", async () => {
    vi.mocked(deleteGroup).mockResolvedValue({});
    renderApp([{ type: "group", id: 2 }], []);

    await chooseAction("Home", "Delete group", favoritesSection()!);

    expect(saveFavorites).toHaveBeenLastCalledWith([]);
  });
});
