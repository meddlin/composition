// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { panelIds } from "../panels/layoutTree";
import { resetPanelPrefs, setWarnDuplicateNotePanels } from "../panels/panelPrefs";
import { useNoteSurface } from "./noteSurface.desktop";
import type { Note } from "./types";
import { createWorkspaceStore, type WorkspaceDeps, type WorkspaceStore } from "./workspaceStore";

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

beforeEach(() => {
  window.localStorage.clear();
  resetPanelPrefs();
});
afterEach(cleanup);

function setup() {
  const store = createWorkspaceStore({ notes: [note(1, "Alpha"), note(2, "Beta")], groups: [] }, {} as WorkspaceDeps, undefined, { panels: {} });
  render(<Harness store={store} />);
  return store;
}

/** The surface a workspace gets on the desktop, with a button for each thing it offers. */
function Harness({ store, windowId }: { store: WorkspaceStore; windowId?: string }) {
  const surface = useNoteSurface(store, windowId);
  const [first] = panelIds(store.getSnapshot().panels.windows[windowId ?? "main"].layout);
  return (
    <>
      <output aria-label="focused note">{surface.focusedNoteId ?? "none"}</output>
      <button onClick={() => surface.openNote(1)}>Open Alpha</button>
      <button onClick={() => surface.openNote(2)}>Open Beta</button>
      <button onClick={() => surface.openNoteBeside(1)}>Alpha to the side</button>
      <button onClick={() => surface.openNoteBeside(2)}>Beta to the side</button>
      <button onClick={() => surface.dropNote(1, first, "right")}>Drop Alpha on the right</button>
      {surface.dialog}
    </>
  );
}

const noteIds = (store: WorkspaceStore) =>
  panelIds(store.getSnapshot().panels.windows.main.layout).map((id) => {
    const panel = store.getSnapshot().panels.byId[id];
    return panel.kind === "note" ? (panel.state as { noteId: number | null }).noteId : null;
  });
const click = (name: string) => act(() => void fireEvent.click(screen.getByRole("button", { name })));

describe("the notes surface of the desktop app", () => {
  it("reports the note in the focused panel, or in the one used last when a panel of another kind is focused", () => {
    const store = setup();
    expect(screen.getByLabelText("focused note").textContent).toBe("none");

    click("Open Beta");
    expect(screen.getByLabelText("focused note").textContent).toBe("2");

    act(() => void store.setPanelKind(store.splitPanel(panelIds(store.getSnapshot().panels.windows.main.layout)[0], "right")!, "notes-browser"));
    expect(screen.getByLabelText("focused note").textContent).toBe("2");
  });

  it("opens a note to the side without asking when no panel shows it", () => {
    const store = setup();
    click("Open Alpha");

    click("Beta to the side");

    expect(noteIds(store)).toEqual([1, 2]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("opening a note that is already open in a panel to the side", () => {
  it("asks first, and opens it a second time if the user goes ahead", () => {
    const store = setup();
    click("Open Alpha");

    click("Alpha to the side");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("“Alpha” is already open in another panel");
    expect(noteIds(store)).toEqual([1]);
    click("Open anyway");

    expect(noteIds(store)).toEqual([1, 1]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("opens nothing if the user cancels", () => {
    const store = setup();
    click("Open Alpha");
    click("Alpha to the side");

    click("Cancel");

    expect(noteIds(store)).toEqual([1]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stops asking once the user ticks the box, until they turn the warning back on", () => {
    const store = setup();
    click("Open Alpha");
    click("Alpha to the side");

    fireEvent.click(screen.getByRole("checkbox", { name: "Don't warn me again" }));
    click("Open anyway");
    click("Alpha to the side");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(noteIds(store)).toEqual([1, 1, 1]);

    act(() => setWarnDuplicateNotePanels(true));
    click("Alpha to the side");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("does not keep the box ticked if the user cancels", () => {
    setup();
    click("Open Alpha");
    click("Alpha to the side");

    fireEvent.click(screen.getByRole("checkbox", { name: "Don't warn me again" }));
    click("Cancel");
    click("Alpha to the side");

    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("dropping a note that is already open in a panel", () => {
  it("asks the same question, and makes the panel when the user goes ahead", () => {
    const store = setup();
    click("Open Alpha");

    click("Drop Alpha on the right");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(noteIds(store)).toEqual([1]);
    click("Open anyway");

    expect(noteIds(store)).toEqual([1, 1]);
  });

  it("does not ask for a note nothing shows", () => {
    const store = setup();
    click("Open Beta");

    click("Drop Alpha on the right");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(noteIds(store)).toEqual([2, 1]);
  });
});

describe("the surface of a pop-out", () => {
  /** The main window shows note 1; a pop-out (w1) shows note 2; the harness is the pop-out's. */
  function inPopout() {
    const store = createWorkspaceStore({ notes: [note(1, "Alpha"), note(2, "Beta"), note(3, "Gamma")], groups: [] }, {} as WorkspaceDeps, undefined, { panels: {} });
    store.openNote(1);
    const [a] = panelIds(store.getSnapshot().panels.windows.main.layout);
    const b = store.splitPanel(a, "right")!;
    store.openNote(2);
    const popout = store.movePanelToNewWindow(b)!;
    render(<Harness store={store} windowId={popout} />);
    return { store, popout };
  }
  const noteIdsIn = (store: WorkspaceStore, windowId: string) =>
    panelIds(store.getSnapshot().panels.windows[windowId].layout).map((id) => (store.getSnapshot().panels.byId[id].state as { noteId: number | null }).noteId);

  it("reports the note in its own window, not the main window's", () => {
    inPopout();

    expect(screen.getByLabelText("focused note").textContent).toBe("2");
  });

  it("opens a picked note in its own window, leaving the main window as it was", () => {
    const { store, popout } = inPopout();
    click("Open Beta");
    click("Beta to the side"); // Beta is open here already: asks first, and goes ahead
    click("Open anyway");

    expect(noteIdsIn(store, popout)).toEqual([2, 2]);
    expect(noteIdsIn(store, "main")).toEqual([1]);
  });
});
