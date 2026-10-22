// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNotebook,
  deleteNotebook,
  moveGroupToNotebook,
  renameNotebook,
} from "@/lib/composition/client";
import { DEFAULT_LAYOUT } from "@/lib/composition/layout";
import { NotesApp } from "./NotesApp";
import { resetNotebookPanelPrefs } from "./notebookPanelPrefs";
import type { Group, Note, Notebook } from "./types";

vi.mock("@/lib/composition/client", () => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  createNotebook: vi.fn(),
  deleteGroup: vi.fn(),
  deleteNote: vi.fn(),
  deleteNotebook: vi.fn(),
  moveGroup: vi.fn(),
  moveGroupToNotebook: vi.fn(),
  moveNoteToGroup: vi.fn(),
  placeGroup: vi.fn(),
  placeNote: vi.fn(),
  renameGroup: vi.fn(),
  renameNotebook: vi.fn(),
  saveFavorites: vi.fn(),
  saveLayout: vi.fn(),
  saveNoteContent: vi.fn(),
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

const at = "2026-01-01T00:00:00.000Z";
const notebook = (id: number, name: string): Notebook => ({ id, name, createdAt: at, updatedAt: at });
const group = (id: number, name: string, notebookId: number, parentId: number | null = null): Group => ({
  id,
  name,
  parentId,
  notebookId,
  createdAt: at,
  updatedAt: at,
});
const note = (id: number, title: string, notebookId: number, groupId: number | null = null): Note => ({
  id,
  title,
  content: "",
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId,
  notebookId,
});

const notebooks = [notebook(1, "Work"), notebook(2, "Home")];
const groups = [group(1, "Projects", 1), group(2, "Chores", 2), group(3, "Garden", 2, 2)];
const notes = [note(1, "Spec", 1, 1), note(2, "Mow", 2, 3), note(3, "Empty-handed", 2)];

function renderApp(props: { notebooks?: Notebook[]; groups?: Group[]; notes?: Note[] } = {}) {
  return render(
    <NotesApp
      initialNotes={props.notes ?? notes}
      initialGroups={props.groups ?? groups}
      initialNotebooks={props.notebooks ?? notebooks}
      initialLayout={DEFAULT_LAYOUT}
    />,
  );
}

/** The sidebar only: an open note is also shown in its pane. */
const nav = () => within(screen.getByRole("navigation", { name: "Notes" }));

/** The notebook list beside the main sidebar. */
const panel = () => within(screen.getByRole("complementary", { name: "Notebooks" }));

/** The highlighted row is the open notebook. */
const activeNotebook = () => panel().getByRole("button", { current: true }).textContent;

function pickNotebook(name: string) {
  fireEvent.click(panel().getByRole("button", { name }));
}

beforeEach(() => {
  window.localStorage.clear();
  resetNotebookPanelPrefs();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotesApp notebooks", () => {
  it("shows only the open notebook's groups and notes", () => {
    renderApp();

    expect(nav().getByText("Projects")).toBeTruthy();
    expect(nav().getByText("Spec")).toBeTruthy();
    expect(nav().queryByText("Chores")).toBeNull();
    expect(nav().queryByText("Mow")).toBeNull();
    expect(activeNotebook()).toBe("Work");
  });

  it("highlights the open notebook in the list instead of naming it above the notes", () => {
    renderApp();

    expect(activeNotebook()).toBe("Work");
    expect(nav().queryByRole("button", { name: /^Notebook:/ })).toBeNull();

    pickNotebook("Home");
    expect(activeNotebook()).toBe("Home");
  });

  it("collapses to a rail with a button that brings the list back, and remembers that", () => {
    renderApp();

    fireEvent.click(panel().getByRole("button", { name: "Hide notebooks" }));
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();
    // With the list gone, the open notebook is named above the notes instead.
    expect(nav().getByRole("button", { name: "Notebook: Work" })).toBeTruthy();
    expect(screen.queryByRole("separator", { name: "Resize notebooks" })).toBeNull();

    cleanup();
    resetNotebookPanelPrefs();
    renderApp();
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();

    fireEvent.click(panel().getByRole("button", { name: "Show notebooks" }));
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(nav().queryByRole("button", { name: /^Notebook:/ })).toBeNull();

    // The name above the notes brings the list back too.
    fireEvent.click(panel().getByRole("button", { name: "Hide notebooks" }));
    fireEvent.click(nav().getByRole("button", { name: "Notebook: Work" }));
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
  });

  it("resizes with its divider, within limits, and remembers the width", () => {
    renderApp();
    const handle = () => screen.getByRole("separator", { name: "Resize notebooks" });
    const start = Number(handle().getAttribute("aria-valuenow"));

    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(start + 16);
    expect((panel().getByRole("heading", { name: "Notebooks" }).closest("aside") as HTMLElement).style.width).toBe(
      `${start + 16}px`,
    );

    fireEvent.pointerDown(handle(), { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 5000 });
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(360);
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: -5000 });
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(120);
    fireEvent.pointerUp(handle(), { pointerId: 1 });

    cleanup();
    resetNotebookPanelPrefs();
    renderApp();
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(120);
  });

  it("switches notebooks from the list, and remembers the choice", () => {
    renderApp();

    pickNotebook("Home");

    expect(activeNotebook()).toBe("Home");
    expect(nav().getByText("Chores")).toBeTruthy();
    expect(nav().getByText("Empty-handed")).toBeTruthy();
    expect(nav().queryByText("Projects")).toBeNull();
    expect(window.localStorage.getItem("composition.notebook")).toBe("2");

    cleanup();
    renderApp();
    expect(activeNotebook()).toBe("Home");
  });

  it("creates a notebook and opens it", async () => {
    vi.mocked(createNotebook).mockResolvedValue(notebook(3, "Reading"));
    renderApp();

    fireEvent.click(panel().getByRole("button", { name: "+ New notebook" }));
    const input = screen.getByPlaceholderText("Notebook name");
    fireEvent.change(input, { target: { value: "Reading" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(createNotebook).toHaveBeenCalledWith("Reading");
    expect(activeNotebook()).toBe("Reading");
    expect(nav().queryByText("Projects")).toBeNull();
  });

  it("renames the open notebook", async () => {
    vi.mocked(renameNotebook).mockResolvedValue(notebook(1, "Job"));
    renderApp();

    fireEvent.pointerDown(panel().getByRole("button", { name: "Actions for notebook Work" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByPlaceholderText("Notebook name") as HTMLInputElement;
    expect(input.value).toBe("Work");
    fireEvent.change(input, { target: { value: "Job" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(renameNotebook).toHaveBeenCalledWith(1, "Job");
    expect(activeNotebook()).toBe("Job");
  });

  it("offers deleting a notebook only when it is empty, and asks first", async () => {
    vi.mocked(deleteNotebook).mockResolvedValue({});
    renderApp();

    const menuFor = (name: string) =>
      fireEvent.pointerDown(panel().getByRole("button", { name: `Actions for notebook ${name}` }), {
        button: 0,
        ctrlKey: false,
      });
    menuFor("Work");
    expect(screen.getByRole("menuitem", { name: "Delete notebook" }).hasAttribute("data-disabled")).toBe(true);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  });

  it("deletes an empty notebook once confirmed, and falls back to another", async () => {
    vi.mocked(deleteNotebook).mockResolvedValue({});
    renderApp({ groups: [group(1, "Projects", 1)], notes: [] });
    pickNotebook("Home");

    fireEvent.pointerDown(panel().getByRole("button", { name: "Actions for notebook Home" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete notebook" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete notebook “Home”?")).toBeTruthy();
    expect(deleteNotebook).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    expect(deleteNotebook).toHaveBeenCalledWith(2);
    expect(activeNotebook()).toBe("Work");
  });

  it("moves a group, with its sub-groups and notes, to another notebook", async () => {
    vi.mocked(moveGroupToNotebook).mockResolvedValue({ group: { ...groups[1], parentId: null, notebookId: 1 } });
    renderApp({ notebooks, groups, notes });
    pickNotebook("Home");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Chores" }), {
      button: 0,
      ctrlKey: false,
    });
    const target = screen.getByRole("menuitem", { name: "Move to Work" });
    await act(async () => {
      fireEvent.click(target);
    });

    expect(moveGroupToNotebook).toHaveBeenCalledWith(2, 1);
    // It left this notebook, with everything inside it.
    expect(nav().queryByText("Chores")).toBeNull();
    expect(nav().queryByText("Garden")).toBeNull();
    expect(nav().getByText("Empty-handed")).toBeTruthy();

    pickNotebook("Work");
    expect(nav().getByText("Chores")).toBeTruthy();
  });

  it("puts the group back when the move is refused", async () => {
    vi.mocked(moveGroupToNotebook).mockResolvedValue({ error: "That group can't be moved there." });
    renderApp();
    pickNotebook("Home");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Chores" }), {
      button: 0,
      ctrlKey: false,
    });
    const target = screen.getByRole("menuitem", { name: "Move to Work" });
    await act(async () => {
      fireEvent.click(target);
    });

    expect(nav().getByText("Chores")).toBeTruthy();
    expect(screen.getByText("That group can't be moved there.")).toBeTruthy();
  });
});
