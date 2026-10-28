// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteNote } from "@/lib/composition/client";
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
  placeNotebook: vi.fn(),
  renameGroup: vi.fn(),
  renameNotebook: vi.fn(),
  saveFavorites: vi.fn(),
  saveHomeSettings: vi.fn(),
  saveLayout: vi.fn(),
  saveNoteContent: vi.fn(),
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

const at = "2026-01-01T00:00:00.000Z";
const notebooks: Notebook[] = [
  { id: 1, name: "Work", createdAt: at, updatedAt: at },
  { id: 2, name: "Home", createdAt: at, updatedAt: at },
];
const groups: Group[] = [{ id: 1, name: "Projects", parentId: null, notebookId: 1, createdAt: at, updatedAt: at }];
const note = (id: number, title: string, notebookId = 1): Note => ({
  id,
  title,
  content: "",
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId: null,
  notebookId,
});
const notes = [note(1, "Alpha"), note(2, "Bravo"), note(3, "Charlie"), note(4, "Mow", 2)];

beforeEach(() => {
  window.localStorage.clear();
  resetNotebookPanelPrefs();
  render(
    <NotesApp initialNotes={notes} initialGroups={groups} initialNotebooks={notebooks} initialLayout={DEFAULT_LAYOUT} />,
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sidebar = () => within(screen.getByRole("navigation", { name: "Notes" }));
const open = (title: string) => fireEvent.click(sidebar().getByText(title));
const mouse = (button: number) => fireEvent.mouseUp(document.body, { button });
const goBack = () => mouse(3);
const goForward = () => mouse(4);

/** The title of the note in the focused pane. */
const focusedNote = () => document.querySelector('section[aria-current="true"]')?.getAttribute("aria-label");

describe("NotesApp history", () => {
  it("goes back to the note that was open before, and forward again", () => {
    open("Bravo");
    open("Charlie");
    expect(focusedNote()).toBe("Charlie");

    goBack();
    expect(focusedNote()).toBe("Bravo");
    goBack();
    expect(focusedNote()).toBe("Alpha");

    goForward();
    expect(focusedNote()).toBe("Bravo");
  });

  it("does nothing at either end of the history", () => {
    goBack();
    expect(focusedNote()).toBe("Alpha");

    open("Bravo");
    goForward();
    expect(focusedNote()).toBe("Bravo");
  });

  it("forgets what was ahead once the user goes somewhere new", () => {
    open("Bravo");
    open("Charlie");
    goBack();
    open("Alpha");

    goForward();
    expect(focusedNote()).toBe("Alpha");
    goBack();
    expect(focusedNote()).toBe("Bravo");
  });

  it("returns to Home, and from it to the note", () => {
    open("Bravo");
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    expect(screen.getByRole("main", { name: "Home" })).toBeTruthy();

    goBack();
    expect(screen.queryByRole("main", { name: "Home" })).toBeNull();
    expect(focusedNote()).toBe("Bravo");

    goForward();
    expect(screen.getByRole("main", { name: "Home" })).toBeTruthy();
  });

  it("returns to a group's page", () => {
    open("Projects");
    expect(screen.getByRole("main", { name: "Group Projects" })).toBeTruthy();
    open("Bravo");

    goBack();
    expect(screen.getByRole("main", { name: "Group Projects" })).toBeTruthy();
  });

  it("follows a note into another notebook and back", () => {
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    open("Mow");
    expect(focusedNote()).toBe("Mow");

    goBack();
    expect(focusedNote()).toBe("Alpha");
    expect(sidebar().getByText("Alpha")).toBeTruthy();
    expect(sidebar().queryByText("Mow")).toBeNull();
  });

  it("passes over a note that was deleted", async () => {
    open("Bravo");
    open("Charlie");

    fireEvent.click(screen.getByRole("button", { name: "Delete Bravo" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    });
    expect(deleteNote).toHaveBeenCalledWith(2);

    goBack();
    expect(focusedNote()).toBe("Alpha");
  });

  it("answers the Back key as well as the mouse button", () => {
    open("Bravo");
    fireEvent.keyDown(document.body, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(document.body, { key: "[", metaKey: true });
    expect(focusedNote()).toBe("Alpha");
  });
});
