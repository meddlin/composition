// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantProvider } from "../notes/AssistantProvider";
import type { Note } from "../notes/types";
import { createWorkspaceStore, type WorkspaceDeps, type WorkspaceStore } from "../notes/workspaceStore";
import { panelIds } from "./layoutTree";
import { MAIN_WINDOW, focusedPanelId } from "./panelsState";
import { PanelCommandPalette } from "./PanelCommandPalette";
import { PanelGrid, type PanelHost } from "./PanelGrid";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => []),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));

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

const sidebar = (): PanelHost["sidebar"] => ({
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

/** A window of panels with the commands mounted beside it, as the notes surface does. */
function setup(prepare: (store: WorkspaceStore) => string = () => MAIN_WINDOW) {
  const deps = { saveNoteContent: vi.fn(async (id: number, content: string) => ({ ...note(id, `Note ${id}`), content })) } as unknown as WorkspaceDeps;
  const store = createWorkspaceStore({ notes: [note(1, "Alpha"), note(2, "Beta")], groups: [] }, deps, undefined, { panels: {} });
  const host: PanelHost = {
    ratio: 0.5,
    onRatioChange: vi.fn(),
    onRatioCommit: vi.fn(),
    onCreateNote: vi.fn(),
    onNewNoteFromText: vi.fn(),
    onOpenNoteBeside: vi.fn(),
    onDropNote: (noteId, panelId, zone) => store.dropNote(noteId, panelId, zone),
    sidebar: sidebar(),
  };
  const windowId = prepare(store);
  render(
    <AssistantProvider store={store.assistant}>
      <PanelGrid store={store} host={host} windowId={windowId} />
      <PanelCommandPalette store={store} windowId={windowId} />
    </AssistantProvider>,
  );
  return { store, windowId };
}

/** Alpha and Beta side by side, Beta focused. */
const twoNotes = (store: WorkspaceStore) => {
  store.openNote(1);
  store.openNoteBeside(2);
  return MAIN_WINDOW;
};

const panelsIn = (store: WorkspaceStore, windowId = MAIN_WINDOW) => panelIds(store.getSnapshot().panels.windows[windowId].layout);
const focusedIn = (store: WorkspaceStore, windowId = MAIN_WINDOW) => focusedPanelId(store.getSnapshot().panels.windows[windowId]);
const editorOf = (title: string) => within(screen.getByRole("region", { name: title })).getByLabelText<HTMLTextAreaElement>("Markdown editor");

/** A command key: Cmd (or Ctrl) and Shift with the physical key, as the keyboard sends it. */
const press = (code: string, target: Element = document.body, over: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(target, { code, key: "", metaKey: true, shiftKey: true, ...over });

const palette = () => screen.queryByRole("dialog", { name: "Command palette" });
const search = () => screen.getByRole("combobox", { name: "Search commands" });
const options = () => screen.getAllByRole("option").map((option) => option.textContent ?? "");

describe("the command palette", () => {
  it("opens with Cmd/Ctrl+Shift+P, wherever the cursor is, with the cursor in its search box", () => {
    setup(twoNotes);
    editorOf("Alpha").focus();
    expect(palette()).toBeNull();

    expect(press("KeyP", editorOf("Alpha"))).toBe(false); // the page's own handling of the key was stopped

    expect(palette()).not.toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it("lists every panel command, with its key beside it where it has one", () => {
    setup();
    press("KeyP");

    expect(options()).toEqual([
      expect.stringMatching(/^Split Right/),
      expect.stringMatching(/^Split Down/),
      expect.stringMatching(/^Close Panel/),
      expect.stringMatching(/^Next Panel/),
      expect.stringMatching(/^Previous Panel/),
      expect.stringMatching(/^Move to New Window/),
      expect.stringMatching(/^Move to Main Window/),
    ]);
    const keys = (name: string) => Array.from(screen.getByRole("option", { name: new RegExp(name) }).querySelectorAll("kbd")).map((k) => k.textContent);
    expect(keys("Split Right")).toEqual(["Ctrl", "Shift", "\\"]); // jsdom is not a Mac
    expect(keys("Close Panel")).toEqual(["Ctrl", "Shift", "W"]);
    expect(keys("Split Down")).toEqual([]);
  });

  it("closes with Esc, or with the key that opened it", () => {
    setup();
    press("KeyP");
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(palette()).toBeNull();

    press("KeyP");
    expect(palette()).not.toBeNull();
    press("KeyP", search());
    expect(palette()).toBeNull();
  });

  it("narrows to what matches as the user types, and says when nothing does", () => {
    setup();
    press("KeyP");

    fireEvent.change(search(), { target: { value: "close" } });
    expect(options()).toEqual([expect.stringContaining("Close Panel")]);

    fireEvent.change(search(), { target: { value: "zebra" } });
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByText("No matching command")).toBeTruthy();
  });

  it("runs the highlighted command on Enter, and the arrow keys move the highlight", () => {
    const { store } = setup();
    press("KeyP");
    fireEvent.change(search(), { target: { value: "split" } });
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false"]);

    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(palette()).toBeNull();
    const { layout } = store.getSnapshot().panels.windows[MAIN_WINDOW];
    expect(layout).toMatchObject({ type: "split", direction: "column" }); // Split Down
  });

  it("runs a command that is clicked", () => {
    const { store } = setup();
    press("KeyP");

    fireEvent.click(screen.getByRole("option", { name: /Split Right/ }));

    expect(panelsIn(store)).toHaveLength(2);
    expect(palette()).toBeNull();
  });

  it("starts from the whole list each time it is opened", () => {
    setup();
    press("KeyP");
    fireEvent.change(search(), { target: { value: "close" } });
    fireEvent.keyDown(search(), { key: "Escape" });

    press("KeyP");

    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect((search() as HTMLInputElement).value).toBe("");
  });

  it("leaves the cursor in the panel the command moved to, not back in the one it was opened from", async () => {
    const { store } = setup(twoNotes);
    act(() => editorOf("Beta").focus());
    press("KeyP", editorOf("Beta"));
    fireEvent.change(search(), { target: { value: "previous" } });

    fireEvent.keyDown(search(), { key: "Enter" });

    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editorOf("Alpha")));
    expect(focusedIn(store)).toBe(panelsIn(store)[0]);
  });

  it("puts the cursor back where it was when closed without a command", async () => {
    setup(twoNotes);
    act(() => editorOf("Beta").focus());
    press("KeyP", editorOf("Beta"));

    fireEvent.keyDown(search(), { key: "Escape" });

    await waitFor(() => expect(document.activeElement).toBe(editorOf("Beta")));
  });

  it("does not run a command key while it is open", () => {
    const { store } = setup(twoNotes);
    press("KeyP");

    press("KeyW", search());

    expect(panelsIn(store)).toHaveLength(2);
  });
});

describe("the keys for panel commands", () => {
  it("split right with Cmd/Ctrl+Shift+\\, from inside a note's editor", () => {
    const { store } = setup(twoNotes);
    const before = panelsIn(store);

    expect(press("Backslash", editorOf("Beta"))).toBe(false);

    expect(panelsIn(store)).toHaveLength(before.length + 1);
    expect(panelsIn(store)[2]).toBe(focusedIn(store)); // the new one, to the right of Beta
  });

  it("move the cursor into the next and previous panel, in layout order", async () => {
    const { store } = setup(twoNotes);
    act(() => editorOf("Alpha").focus());

    press("BracketRight", editorOf("Alpha"));
    await waitFor(() => expect(document.activeElement).toBe(editorOf("Beta")));
    expect(focusedIn(store)).toBe(panelsIn(store)[1]);

    press("BracketLeft", editorOf("Beta"));
    await waitFor(() => expect(document.activeElement).toBe(editorOf("Alpha")));
    expect(focusedIn(store)).toBe(panelsIn(store)[0]);
  });

  it("close the focused panel with Cmd/Ctrl+Shift+W, and put the cursor in the one that is left", async () => {
    const { store } = setup(twoNotes);
    act(() => editorOf("Beta").focus());

    press("KeyW", editorOf("Beta"));

    expect(panelsIn(store)).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(editorOf("Alpha")));
  });

  it("leave the layout alone without Shift, so the note's own keys (Cmd/Ctrl+\\ steps its view) still work", () => {
    const { store } = setup(twoNotes);
    const before = store.getSnapshot().panels.windows[MAIN_WINDOW].layout;

    press("Backslash", editorOf("Beta"), { shiftKey: false });
    press("KeyW", editorOf("Beta"), { shiftKey: false });
    press("BracketRight", editorOf("Beta"), { shiftKey: false });

    expect(store.getSnapshot().panels.windows[MAIN_WINDOW].layout).toBe(before);
    expect(focusedIn(store)).toBe(panelsIn(store)[1]);
  });
});

describe("in a pop-out", () => {
  function popoutSetup() {
    return setup((store) => {
      store.openNote(1);
      store.openNoteBeside(2);
      return store.movePanelToNewWindow(panelIds(store.getSnapshot().panels.windows[MAIN_WINDOW].layout)[1])!;
    });
  }

  it("the palette and keys act on that window's own panels", () => {
    const { store, windowId } = popoutSetup();
    const mainBefore = panelsIn(store);

    press("Backslash", editorOf("Beta"));

    expect(panelsIn(store, windowId)).toHaveLength(2);
    expect(panelsIn(store)).toEqual(mainBefore);
  });

  it("Move to Main Window brings the panel back from the palette", () => {
    const { store, windowId } = popoutSetup();
    press("KeyP");
    fireEvent.change(search(), { target: { value: "main" } });

    fireEvent.keyDown(search(), { key: "Enter" });

    expect(Object.keys(store.getSnapshot().panels.windows)).toEqual([MAIN_WINDOW]);
    expect(windowId).not.toBe(MAIN_WINDOW);
  });
});
