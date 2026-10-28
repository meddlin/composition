// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { panelIds } from "../panels/layoutTree";
import type { Note, Notebook } from "../notes/types";
import { createWorkspaceStore, type WorkspaceDeps } from "../notes/workspaceStore";
import { PopoutApp } from "./PopoutApp";
import type { SharedWorkspace } from "./popoutLink";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => []),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));

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
const notebooks: Notebook[] = [{ id: 1, name: "Notebook", createdAt: "", updatedAt: "" }];

let close: ReturnType<typeof vi.fn>;
beforeEach(() => {
  close = vi.fn();
  window.close = close as unknown as typeof window.close;
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, "opener", { value: null, configurable: true });
  window.history.replaceState({}, "", "/");
  document.title = "";
});

/** The main window's workspace with note 1 in it and a pop-out, w1, holding note 2 (a, b); `open` makes this page w1's. */
function setup({ opener = true, path = "/popout/?w=w1" } = {}) {
  const saveNoteContent = vi.fn(async (id: number, content: string) => ({ ...note(id, `Note ${id}`), content }));
  const store = createWorkspaceStore({ notes: [note(1, "Alpha"), note(2, "Beta")], groups: [], notebooks }, { saveNoteContent, deleteNote: vi.fn() } as unknown as WorkspaceDeps, undefined, { panels: {} });
  store.openNote(1);
  const [a] = panelIds(store.getSnapshot().panels.windows.main.layout);
  const b = store.splitPanel(a, "right")!;
  store.openNote(2);
  const popout = store.movePanelToNewWindow(b)!;
  const shared: SharedWorkspace = { store, writing: { ruler: false, reflow: false } } as unknown as SharedWorkspace;
  if (opener) Object.defineProperty(window, "opener", { value: { __workspace: shared }, configurable: true });
  window.history.replaceState({}, "", path);
  return { store, popout, b, a, saveNoteContent };
}

describe("a pop-out's panel commands", () => {
  const press = (code: string) => fireEvent.keyDown(document.body, { code, key: "", metaKey: true, shiftKey: true });

  it("are in its own palette, which acts on its own window's panels", async () => {
    const { store, popout } = setup();
    render(<PopoutApp />);
    const mainBefore = panelIds(store.getSnapshot().panels.windows.main.layout);

    act(() => void press("KeyP"));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Search commands" }), { target: { value: "split right" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search commands" }), { key: "Enter" });

    expect(panelIds(store.getSnapshot().panels.windows[popout].layout)).toHaveLength(2);
    expect(panelIds(store.getSnapshot().panels.windows.main.layout)).toEqual(mainBefore);
  });
});

describe("a pop-out's page", () => {
  it("shows the panels of its window from the main window's workspace", async () => {
    setup();
    render(<PopoutApp />);

    expect(await screen.findByRole("region", { name: "Beta" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Alpha" })).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes itself when no window opened it, as after the app was started on its address", () => {
    setup({ opener: false });
    render(<PopoutApp />);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes itself when its window is not in the workspace, as one left over from an earlier run", () => {
    setup({ path: "/popout/?w=w9" });
    render(<PopoutApp />);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes itself when it was given no window to show", () => {
    setup({ path: "/popout/" });
    render(<PopoutApp />);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("is titled for the panel in front, and follows it", async () => {
    const { store, b } = setup();
    render(<PopoutApp />);
    await screen.findByRole("region", { name: "Beta" });
    expect(document.title).toBe("Beta");

    act(() => {
      const second = store.splitPanel(b, "right")!;
      store.setPanelKind(second, "notes-browser");
    });

    expect(document.title).toBe("Notes browser");
    act(() => store.focusPanel(b));
    expect(document.title).toBe("Beta");
  });

  it("does not drop its window from the workspace when the page is left: the app also tears pop-outs down as it quits, and they must come back", async () => {
    const { store, popout } = setup();
    render(<PopoutApp />);
    await screen.findByRole("region", { name: "Beta" });

    act(() => void window.dispatchEvent(new Event("pagehide")));

    expect(store.getSnapshot().panels.windows[popout]).toBeDefined();
  });

  it("closes itself when its window leaves the workspace, as when its last panel is moved back", async () => {
    const { store, b } = setup();
    render(<PopoutApp />);
    await screen.findByRole("region", { name: "Beta" });

    act(() => store.movePanelToWindow(b, "main"));

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("edits the one note the main window holds: typing here shows there", async () => {
    const { store } = setup();
    render(<PopoutApp />);
    const editor = within(await screen.findByRole("region", { name: "Beta" })).getByLabelText("Markdown editor");

    fireEvent.change(editor, { target: { value: "typed in the pop-out" } });

    expect(store.getSnapshot().notes.find((n) => n.id === 2)?.content).toBe("typed in the pop-out");
  });
});
