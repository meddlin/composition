// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatsStore, type ChatsStore } from "@/lib/composition/assistant/chatsStore";
import type { ChatRequest } from "@/lib/composition/assistant/types";
import { listAssistantModels } from "@/lib/composition/client";
import { AssistantProvider } from "../notes/AssistantProvider";
import { NOTE_DRAG_TYPE, PANEL_DRAG_TYPE } from "../notes/dragTypes";
import type { Note, Notebook } from "../notes/types";
import { createWorkspaceStore, type WorkspaceDeps, type WorkspaceStore } from "../notes/workspaceStore";
import { panelIds } from "./layoutTree";
import { PanelGrid, type PanelHost } from "./PanelGrid";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => []),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));

vi.mock("@/lib/composition/client", async (importOriginal) => ({ ...(await importOriginal<object>()), listAssistantModels: vi.fn() }));

beforeEach(() => {
  vi.mocked(listAssistantModels).mockResolvedValue({
    serverUrl: "http://127.0.0.1:11434",
    local: true,
    contextTokens: 8192,
    hiddenCloud: 0,
    models: [{ name: "qwen3:0.6b", parameterSize: "751M", contextLength: 40960, capabilities: ["completion"] }],
  });
});
afterEach(cleanup);

const note = (id: number, title: string): Note => ({
  id,
  title,
  content: `body of ${title}`,
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  notebookId: 1,
});

const notebook = (id: number, name: string): Notebook => ({ id, name, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

/** The notes browser's other buttons are not what these tests are about, so they do nothing. */
const noSidebarActions = (): PanelHost["sidebar"] => ({
  groupError: null,
  onToggleFavorite: vi.fn(),
  onSelectGroup: vi.fn(),
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onCreateGroup: vi.fn(),
  onRenameGroup: vi.fn(),
  onDeleteGroup: vi.fn(),
  onMoveGroup: vi.fn(),
  onPlaceNote: vi.fn(),
  onPlaceGroup: vi.fn(),
  onMoveNoteToGroup: vi.fn(),
  onMoveGroupToNotebook: vi.fn(),
});

/** A workspace with panels; only the bridge is faked, and the saves are collected. */
function setup(
  notes: Note[] = [note(1, "Alpha"), note(2, "Beta")],
  notebooks: Notebook[] = [notebook(1, "Notebook 1")],
  prepare: (store: WorkspaceStore) => string = () => "main",
  assistant?: ChatsStore,
) {
  const save = vi.fn();
  const deps = {
    saveNoteContent: vi.fn(async (id: number, content: string) => ({ ...note(id, `Note ${id}`), content })),
    deleteNote: vi.fn(async () => {}),
  } as unknown as WorkspaceDeps;
  const store = createWorkspaceStore({ notes, groups: [], notebooks }, deps, assistant, { panels: { save } });
  const host: PanelHost = {
    ratio: 0.5,
    onRatioChange: vi.fn(),
    onRatioCommit: vi.fn(),
    onCreateNote: vi.fn(),
    onNewNoteFromText: vi.fn(),
    onOpenNoteBeside: vi.fn(),
    onDropNote: (noteId, panelId, zone) => store.dropNote(noteId, panelId, zone),
    sidebar: noSidebarActions(),
  };
  const windowId = prepare(store);
  render(
    <AssistantProvider store={store.assistant}>
      <PanelGrid store={store} host={host} windowId={windowId} />
    </AssistantProvider>,
  );
  return { store, save, host };
}

const layoutOf = (store: WorkspaceStore) => store.getSnapshot().panels.windows.main.layout;
const kinds = (store: WorkspaceStore) => panelIds(layoutOf(store)).map((id) => store.getSnapshot().panels.byId[id].kind);
const emptyPanels = () => screen.queryAllByRole("region", { name: "Empty panel" });

/** Radix opens its menu on a left-button pointerdown. */
async function chooseFromMenu(panel: HTMLElement, item: string) {
  fireEvent.pointerDown(within(panel).getByRole("button", { name: "Panel options" }), { button: 0, ctrlKey: false });
  await act(async () => {
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: item }));
  });
}

describe("a window of panels", () => {
  it("starts as one empty panel that offers the kinds of panel to turn it into", () => {
    setup();

    const [panel] = emptyPanels();
    expect(within(panel).getByRole("button", { name: "Note" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Notes browser" })).toBeTruthy();
    expect(screen.queryAllByRole("separator")).toEqual([]);
  });

  it("turns an empty panel into the kind chosen in it", () => {
    const { store } = setup();

    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "Notes browser" }));

    expect(kinds(store)).toEqual(["notes-browser"]);
  });

  it("makes a new empty panel to the right with + and shows a divider between the two", () => {
    const { store } = setup();

    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "New panel" }));

    expect(kinds(store)).toEqual(["empty", "empty"]);
    expect(emptyPanels()).toHaveLength(2);
    expect(screen.getByRole("separator", { name: "Resize panels 1 and 2" }).getAttribute("aria-orientation")).toBe("vertical");
  });

  it("makes it below instead when + is clicked with Option held", () => {
    const { store } = setup();

    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "New panel" }), { altKey: true });

    expect(layoutOf(store)).toMatchObject({ type: "split", direction: "column" });
    expect(screen.getByRole("separator", { name: "Resize panels 1 and 2" }).getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("splits and closes from the panel's menu", async () => {
    const { store } = setup();

    await chooseFromMenu(emptyPanels()[0], "Split down");
    expect(layoutOf(store)).toMatchObject({ direction: "column" });

    await chooseFromMenu(emptyPanels()[0], "Split right");
    expect(panelIds(layoutOf(store))).toHaveLength(3);

    await chooseFromMenu(emptyPanels()[0], "Close");
    expect(panelIds(layoutOf(store))).toHaveLength(2);
    expect(emptyPanels()).toHaveLength(2);
  });

  it("closes a panel with its close button", () => {
    const { store } = setup();
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "New panel" }));

    fireEvent.click(within(emptyPanels()[1]).getByRole("button", { name: "Close panel" }));

    expect(panelIds(layoutOf(store))).toHaveLength(1);
  });

  it("offers no close button for a window's only panel while it is empty, as there is nothing to close", () => {
    setup();
    expect(within(emptyPanels()[0]).queryByRole("button", { name: "Close panel" })).toBeNull();

    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "Notes browser" }));

    expect(screen.getByRole("button", { name: "Close panel" })).toBeTruthy();
  });

  it("focuses the panel the pointer goes down in", () => {
    const { store } = setup();
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "New panel" }));
    const [first] = panelIds(layoutOf(store));
    expect(store.getSnapshot().panels.windows.main.focusOrder[0]).not.toBe(first);

    fireEvent.pointerDown(emptyPanels()[0]);

    expect(store.getSnapshot().panels.windows.main.focusOrder[0]).toBe(first);
  });
});

describe("resizing panels", () => {
  function twoPanels() {
    const made = setup();
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "New panel" }));
    const handle = screen.getByRole("separator", { name: "Resize panels 1 and 2" });
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 600 } as DOMRect);
    return { ...made, handle };
  }
  const sizes = (store: WorkspaceStore) => {
    const layout = layoutOf(store);
    return layout.type === "split" ? layout.children.map((child) => child.size) : [];
  };

  it("trades width between the panels either side of a divider while it is dragged", () => {
    const { store, handle } = twoPanels();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });

    // 1000 px for two equal panels is 500 px a unit, so 100 px is 0.2 of one.
    expect(sizes(store)).toEqual([1.2, 0.8]);
  });

  it("sends the arrangement to be saved once, when the drag ends", () => {
    const { handle, save } = twoPanels();
    save.mockClear();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 550 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 });
    expect(save).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not let a panel get narrower than its minimum", () => {
    const { store, handle } = twoPanels();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5000 });

    // The right panel keeps 240 px of the 1000: 0.48 of a 500 px unit.
    expect(sizes(store)[1]).toBeCloseTo(0.48);
  });

  it("moves a divider between stacked panels with the up and down arrow keys", () => {
    const made = setup();
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "New panel" }), { altKey: true });
    const handle = screen.getByRole("separator", { name: "Resize panels 1 and 2" });
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 1000 } as DOMRect);

    fireEvent.keyDown(handle, { key: "ArrowDown" });

    // 16 px of 1000 for 2 units.
    expect(sizes(made.store)[0]).toBeCloseTo(1.032);
  });
});

describe("dragging onto a panel", () => {
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
  /** Fires a drag event at `target` with the pointer at the given place. */
  function drag(kind: "dragOver" | "drop", target: Element, dt: ReturnType<typeof dataTransfer>, x: number, y: number) {
    const event = createEvent[kind](target, { dataTransfer: dt });
    Object.defineProperty(event, "clientX", { value: x });
    Object.defineProperty(event, "clientY", { value: y });
    return fireEvent(target, event);
  }
  /** jsdom lays nothing out, so give a panel the 1000 x 600 box the drop zones are read from. */
  function sizePanel(panel: Element) {
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 } as DOMRect);
  }
  const noteDrag = (id: number) => {
    const dt = dataTransfer();
    dt.setData(NOTE_DRAG_TYPE, String(id));
    return dt;
  };

  it("shows where a dragged note would land: the side of the panel nearest the pointer", () => {
    setup();
    const [panel] = emptyPanels();
    sizePanel(panel);
    const zone = () => panel.querySelector("[data-drop-zone]")?.getAttribute("data-drop-zone") ?? null;
    const dt = noteDrag(1);

    drag("dragOver", panel, dt, 900, 300);
    expect(zone()).toBe("right");
    drag("dragOver", panel, dt, 100, 300);
    expect(zone()).toBe("left");
    drag("dragOver", panel, dt, 500, 20);
    expect(zone()).toBe("top");
    drag("dragOver", panel, dt, 500, 590);
    expect(zone()).toBe("bottom");
    drag("dragOver", panel, dt, 500, 300);
    expect(zone()).toBe("center");
  });

  it("makes a note panel on the side a note is dropped", () => {
    const { store } = setup();
    const [panel] = emptyPanels();
    sizePanel(panel);

    drag("drop", panel, noteDrag(2), 900, 300);

    expect(kinds(store)).toEqual(["empty", "note"]);
  });

  it("fills an empty panel with a note dropped on its middle", () => {
    const { store } = setup();
    const [panel] = emptyPanels();
    sizePanel(panel);

    drag("drop", panel, noteDrag(2), 500, 300);

    expect(kinds(store)).toEqual(["note"]);
  });

  it("moves a panel dragged by its header to the side of another", () => {
    const { store } = setup();
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "New panel" }));
    const [first, second] = panelIds(layoutOf(store));
    fireEvent.click(within(emptyPanels()[1]).getByRole("button", { name: "Notes browser" }));
    const target = screen.getByRole("region", { name: "Notes browser" });
    sizePanel(target);
    const dt = dataTransfer();
    dt.setData(PANEL_DRAG_TYPE, first);

    drag("drop", target, dt, 900, 300);

    expect(panelIds(layoutOf(store))).toEqual([second, first]);
    expect(kinds(store)).toEqual(["notes-browser", "empty"]);
  });
});

describe("a note in a panel", () => {
  const editorIn = (title: string) => within(screen.getByRole("region", { name: title })).getByLabelText<HTMLTextAreaElement>("Markdown editor");
  const panelOf = (store: WorkspaceStore, id: string) => store.getSnapshot().panels.byId[id];

  it("shows the note, with the controls of a panel", () => {
    const { store } = setup();
    act(() => store.openNote(1));

    const alpha = screen.getByRole("region", { name: "Alpha" });
    expect(editorIn("Alpha").value).toBe("body of Alpha");
    expect(within(alpha).getByRole("button", { name: "New panel" })).toBeTruthy();
    expect(within(alpha).getByRole("button", { name: "Panel options" })).toBeTruthy();
  });

  it("edits the note through the workspace, so the same note in two panels stays in step", () => {
    const { store } = setup();
    act(() => {
      store.openNote(1);
      store.openNoteBeside(1);
    });
    const [first, second] = screen.getAllByLabelText<HTMLTextAreaElement>("Markdown editor");

    fireEvent.change(first, { target: { value: "typed in the first panel" } });

    expect(second.value).toBe("typed in the first panel");
    expect(store.getSnapshot().notes[0].content).toBe("typed in the first panel");
  });

  it("keeps which tab it is on in the panel's saved state", () => {
    const { store } = setup();
    act(() => store.openNote(1));
    const [id] = panelIds(layoutOf(store));

    fireEvent.click(within(screen.getByRole("region", { name: "Alpha" })).getByRole("tab", { name: "Preview" }));

    expect(panelOf(store, id).state).toEqual({ noteId: 1, view: "preview" });
  });

  it("is dragged by its header as a panel", () => {
    const { store } = setup();
    act(() => store.openNote(1));
    const [id] = panelIds(layoutOf(store));
    const data = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => void data.set(type, value), effectAllowed: "all" };

    fireEvent.dragStart(screen.getByRole("region", { name: "Alpha" }).querySelector("header")!, { dataTransfer });

    expect(data.get(PANEL_DRAG_TYPE)).toBe(id);
  });

  it("opens a note a link points at in the same panel, or beside it", () => {
    const { store } = setup([note(1, "Alpha"), note(2, "Beta")]);
    act(() => store.openNote(1));

    act(() => store.openLinkedNote(2, panelIds(layoutOf(store))[0], false));

    expect(screen.getByRole("region", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Alpha" })).toBeNull();
  });

  it("waits for a note when it has none yet, and offers to make one", () => {
    const { store, host } = setup();
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "Note" }));
    expect(kinds(store)).toEqual(["note"]);

    const panel = screen.getByRole("region", { name: "Note" });
    expect(within(panel).getByText(/Pick a note in the sidebar/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "+ New note" }));

    expect(host.onCreateNote).toHaveBeenCalledTimes(1);
  });
});

describe("a note that was deleted while it is shown", () => {
  function deleted() {
    const made = setup();
    act(() => made.store.openNote(1));
    act(() => made.store.removeNote(1));
    return made;
  }

  it("stays in its panel with its title struck through and the reason on hover", () => {
    deleted();

    const panel = screen.getByRole("region", { name: "Alpha" });
    const title = within(panel).getByText("Alpha");
    expect(title.className).toContain("line-through");
    expect(title.getAttribute("title")).toBe("Deleted — in the Trash Can");
  });

  it("shows what the note said, grayed out and read-only", () => {
    deleted();

    const editor = within(screen.getByRole("region", { name: "Alpha" })).getByLabelText<HTMLTextAreaElement>("Markdown editor");
    expect(editor.value).toBe("body of Alpha");
    expect(editor.readOnly).toBe(true);
    expect(editor.closest("[data-deleted]")).not.toBeNull();
  });

  it("cannot be given a diagram or a header image", () => {
    deleted();
    const panel = screen.getByRole("region", { name: "Alpha" });

    expect((within(panel).getByRole("button", { name: /Diagram/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(panel).getByRole("button", { name: /Header image/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is closed by the user, like any panel", () => {
    const { store } = deleted();

    fireEvent.click(within(screen.getByRole("region", { name: "Alpha" })).getByRole("button", { name: "Close panel" }));

    expect(kinds(store)).toEqual(["empty"]);
    expect(store.getSnapshot().deleted).toEqual([]);
  });
});

describe("a notes browser in a panel", () => {
  const work = note(3, "Plan");
  const inWork = { ...work, notebookId: 2 };
  const notebooks = [notebook(1, "Notebook 1"), notebook(2, "Work")];
  const notesNav = () => within(screen.getByRole("navigation", { name: "Notes" }));

  function browser() {
    const made = setup([note(1, "Alpha"), note(2, "Beta"), inWork], notebooks);
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "Notes browser" }));
    return made;
  }

  it("lists the notes of a notebook as a tree of its own", () => {
    browser();

    expect(notesNav().getByText("Alpha")).toBeTruthy();
    expect(notesNav().getByText("Beta")).toBeTruthy();
    expect(notesNav().queryByText("Plan")).toBeNull();
  });

  it("switches to another notebook without touching the rest of the window, and remembers which", () => {
    const { store } = browser();
    const [id] = panelIds(layoutOf(store));

    fireEvent.pointerDown(screen.getByRole("button", { name: "Notebook: Notebook 1" }), { button: 0, ctrlKey: false });
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "Work" }));

    expect(notesNav().getByText("Plan")).toBeTruthy();
    expect(notesNav().queryByText("Alpha")).toBeNull();
    expect(store.getSnapshot().panels.byId[id].state).toEqual({ notebookId: 2 });
  });

  it("opens a picked note in the note panel used last, and leaves the browser's own place", () => {
    const { store } = setup([note(1, "Alpha"), note(2, "Beta")], notebooks);
    act(() => store.openNote(1));
    const [a] = panelIds(layoutOf(store));
    const b = store.splitPanel(a, "right")!;
    act(() => store.setPanelKind(b, "notes-browser"));

    fireEvent.click(notesNav().getByText("Beta"));

    expect(screen.getByRole("region", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Alpha" })).toBeNull();
    expect(panelIds(layoutOf(store))).toEqual([a, b]);
  });
});

describe("moving a panel between windows, from its menu", () => {
  const windowsOf = (store: WorkspaceStore) => Object.keys(store.getSnapshot().panels.windows);
  const panelsOf = (store: WorkspaceStore, windowId: string) => panelIds(store.getSnapshot().panels.windows[windowId].layout);

  /** Two panels in the main window; the second is the one a test moves. */
  function inMain() {
    return setup(undefined, undefined, (store) => {
      store.splitPanel(panelIds(store.getSnapshot().panels.windows.main.layout)[0], "right");
      return "main";
    });
  }
  /** What the first menu on the page offers. */
  async function openMenu(panel: HTMLElement) {
    fireEvent.pointerDown(within(panel).getByRole("button", { name: "Panel options" }), { button: 0, ctrlKey: false });
    await screen.findByRole("menu");
  }

  it("offers to move a panel into a window of its own, and does", async () => {
    const { store } = inMain();
    const [first, second] = panelIds(layoutOf(store));
    await openMenu(emptyPanels()[1]);

    await act(async () => {
      fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move to new window" }));
    });

    expect(windowsOf(store)).toEqual(["main", "w1"]);
    expect(panelsOf(store, "w1")).toEqual([second]);
    expect(panelsOf(store, "main")).toEqual([first]);
    // The grid shows the main window's panels, so the panel has left it.
    expect(emptyPanels()).toHaveLength(1);
  });

  it("offers no other window to move to while there is none, and no way back from the main window", async () => {
    inMain();
    await openMenu(emptyPanels()[0]);

    const menu = within(screen.getByRole("menu"));
    expect(menu.queryByRole("menuitem", { name: /Move to window/ })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Move back to main window" })).toBeNull();
  });

  it("lists the other windows to move a panel to, by number, and moves it there", async () => {
    const { store } = inMain();
    const [first, second] = panelIds(layoutOf(store));
    act(() => void store.movePanelToNewWindow(second)); // w1
    const third = store.splitPanel(first, "right")!;
    act(() => void store.movePanelToNewWindow(third)); // w2
    await openMenu(emptyPanels()[0]);

    const toWindow = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move to window" });
    fireEvent.keyDown(toWindow, { key: "ArrowRight" });
    const submenu = await screen.findAllByRole("menu");
    const names = within(submenu[submenu.length - 1]).getAllByRole("menuitem").map((item) => item.textContent);
    expect(names).toEqual(["Window 1", "Window 2"]);

    await act(async () => {
      fireEvent.click(within(submenu[submenu.length - 1]).getByRole("menuitem", { name: "Window 2" }));
    });

    expect(panelsOf(store, "w2")).toEqual([third, first]);
    expect(panelsOf(store, "w1")).toEqual([second]);
  });

  describe("in a pop-out", () => {
    function inPopout() {
      return setup(undefined, undefined, (store) => {
        const first = panelIds(store.getSnapshot().panels.windows.main.layout)[0];
        const second = store.splitPanel(first, "right")!;
        store.splitPanel(second, "right");
        return store.movePanelToNewWindow(second)!;
      });
    }

    it("shows that window's panels, with a way back to the main window", async () => {
      const { store } = inPopout();
      await openMenu(emptyPanels()[0]);

      await act(async () => {
        fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Move back to main window" }));
      });

      expect(windowsOf(store)).toEqual(["main"]);
      expect(panelsOf(store, "main")).toHaveLength(3);
    });

    it("offers no new window for a pop-out's only panel, which would only trade one window for another", async () => {
      inPopout();
      await openMenu(emptyPanels()[0]);

      expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Move to new window" })).toBeNull();
    });

    it("has a close button even on an only panel that is empty, which closes the window", () => {
      const { store } = inPopout();

      fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "Close panel" }));

      expect(windowsOf(store)).toEqual(["main"]);
    });
  });
});

describe("the AI helper as a panel", () => {
  const aiPanel = () => screen.getByRole("region", { name: "AI helper" });
  const composer = () => within(aiPanel()).getByLabelText<HTMLTextAreaElement>("Ask about this note");
  const toggle = () => within(aiPanel()).getByRole("button", { name: "Follow the note in use" });
  /** A workspace with note 1 open in the one panel, and the panel's id. */
  function withNoteOpen(assistant?: ChatsStore) {
    const result = setup(undefined, undefined, undefined, assistant);
    act(() => result.store.openNote(1));
    return { ...result, notePanel: panelIds(layoutOf(result.store))[0] };
  }
  const openFromNote = (title = "Alpha") =>
    fireEvent.click(within(screen.getByRole("region", { name: title })).getByRole("button", { name: "AI helper" }));

  it("opens from a note's AI helper button as a panel beside it, not as a dock inside it", async () => {
    const { store } = withNoteOpen();

    openFromNote();

    expect(kinds(store)).toEqual(["note", "ai"]);
    expect(within(screen.getByRole("region", { name: "Alpha" })).queryByRole("complementary")).toBeNull();
    expect(within(aiPanel()).getByText("Alpha")).toBeTruthy(); // the note it is about
    await within(aiPanel()).findByRole("option", { name: /qwen3/ });
  });

  it("opens with the cursor in the question box", async () => {
    withNoteOpen();

    openFromNote();

    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it("opens from Ctrl/Cmd+Shift+L in the note panel being worked in, and the next press goes to the panel it made", () => {
    const { store, notePanel } = withNoteOpen();

    fireEvent.keyDown(document, { key: "L", shiftKey: true, metaKey: true });
    expect(kinds(store)).toEqual(["note", "ai"]);

    act(() => store.focusPanel(notePanel));
    fireEvent.keyDown(document, { key: "L", shiftKey: true, metaKey: true });
    expect(kinds(store)).toEqual(["note", "ai"]);
    expect(screen.getByRole("region", { name: "AI helper" }).getAttribute("aria-current")).toBe("true");
  });

  it("answers about its note, in that note's chat", async () => {
    const requests: ChatRequest[] = [];
    const streamChat = async function* (request: ChatRequest) {
      requests.push(request);
      yield { type: "delta" as const, text: "Take the tram." };
      yield { type: "done" as const };
    };
    withNoteOpen(createChatsStore({ streamChat }));
    openFromNote();
    await within(aiPanel()).findByRole("option", { name: /qwen3/ });

    fireEvent.change(composer(), { target: { value: "How do I get there?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });

    expect(await within(aiPanel()).findByText("Take the tram.")).toBeTruthy();
    const sent = requests[0].messages.map((m) => m.content).join("\n");
    expect(sent).toContain("body of Alpha");
    expect(sent).toContain("How do I get there?");
  });

  it("stays on the note it is pinned to when the user works in another", () => {
    const { store } = withNoteOpen();
    openFromNote();
    act(() => store.openNoteBeside(2));

    expect(within(aiPanel()).getByText("Alpha")).toBeTruthy();
    expect(within(aiPanel()).queryByText("Beta")).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("follows the note in use when told to, and pins to the note it is about when told not to", () => {
    const { store } = withNoteOpen();
    openFromNote();
    act(() => store.openNoteBeside(2));

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(within(aiPanel()).getByText("Beta")).toBeTruthy();
    expect(within(aiPanel()).queryByText("Alpha")).toBeNull();

    fireEvent.click(toggle());
    act(() => store.focusPanel(panelIds(layoutOf(store))[0]));
    expect(within(aiPanel()).getByText("Beta")).toBeTruthy();
  });

  it("starts a fresh question when the note it follows changes, rather than carrying the draft over", async () => {
    const { store } = withNoteOpen();
    openFromNote();
    fireEvent.click(toggle()); // follow
    await within(aiPanel()).findByRole("option", { name: /qwen3/ });
    fireEvent.change(composer(), { target: { value: "What about the tram?" } });

    act(() => store.openNoteBeside(2));

    expect(within(aiPanel()).getByText("Beta")).toBeTruthy();
    expect(composer().value).toBe("");
  });

  it("is offered by an empty panel, and follows the note in use", () => {
    const { store } = setup();
    act(() => store.openNote(1));
    act(() => void store.splitPanel(panelIds(layoutOf(store))[0], "right"));

    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "AI helper" }));

    expect(kinds(store)).toEqual(["note", "ai"]);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(within(aiPanel()).getByText("Alpha")).toBeTruthy();
  });

  it("says so, and has nothing to ask, when it follows and no note is open", () => {
    setup();
    fireEvent.click(within(emptyPanels()[0]).getByRole("button", { name: "AI helper" }));

    expect(within(aiPanel()).getByText("Open a note to ask about it.")).toBeTruthy();
    expect(within(aiPanel()).queryByLabelText("Ask about this note")).toBeNull();
  });

  it("shows a deleted note struck through, cannot be asked about it, and still shows the chat", async () => {
    const streamChat = async function* () {
      yield { type: "delta" as const, text: "Take the tram." };
      yield { type: "done" as const };
    };
    const { store } = withNoteOpen(createChatsStore({ streamChat }));
    openFromNote();
    await within(aiPanel()).findByRole("option", { name: /qwen3/ });
    fireEvent.change(composer(), { target: { value: "How do I get there?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await within(aiPanel()).findByText("Take the tram.");

    act(() => store.removeNote(1));

    expect(within(aiPanel()).getByText("Alpha").className).toContain("line-through");
    expect(composer().disabled).toBe(true);
    expect(within(aiPanel()).getByText("Take the tram.")).toBeTruthy();
  });

  it("takes the selection from its note's panel, in the same window, when the user moves into it", async () => {
    withNoteOpen();
    openFromNote();
    await waitFor(() => expect(document.activeElement).toBe(composer())); // opening has finished with focus
    const editor = within(screen.getByRole("region", { name: "Alpha" })).getByLabelText<HTMLTextAreaElement>("Markdown editor");
    act(() => editor.focus());
    editor.setSelectionRange(0, 4);

    act(() => composer().focus());

    expect(within(aiPanel()).getByText("Selection (4 characters)")).toBeTruthy();
  });

  it("is moved and closed from its panel menu like any panel", async () => {
    const { store } = withNoteOpen();
    openFromNote();

    await chooseFromMenu(aiPanel(), "Close");

    expect(kinds(store)).toEqual(["note"]);
  });
});
