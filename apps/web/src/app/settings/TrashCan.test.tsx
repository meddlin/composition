// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  permanentlyDeleteGroup,
  permanentlyDeleteNote,
  restoreGroup,
  restoreNote,
} from "@/lib/composition/client";
import { expiryOf, type Trash } from "@/lib/composition/trash";
import { TrashCan } from "./TrashCan";

vi.mock("@/lib/composition/client", () => ({
  permanentlyDeleteGroup: vi.fn(async () => {}),
  permanentlyDeleteNote: vi.fn(async () => {}),
  restoreGroup: vi.fn(async () => ({})),
  restoreNote: vi.fn(async () => ({})),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function entry<T extends object>(fields: T, deletedAt: string) {
  return { ...fields, deletedAt, expiresAt: expiryOf(deletedAt) };
}

const trash: Trash = {
  notes: [entry({ id: 1, title: "Groceries" }, daysAgo(10)), entry({ id: 2, title: "  " }, daysAgo(59.5))],
  groups: [entry({ id: 7, name: "Old projects" }, daysAgo(1))],
};

function renderTrash(initial: Trash = trash) {
  render(<TrashCan initialTrash={initial} />);
}

describe("TrashCan", () => {
  it("always says that items are permanently deleted after 60 days", () => {
    renderTrash({ notes: [], groups: [] });

    expect(screen.getByText(/permanently deleted automatically after 60 days in the Trash Can/)).toBeTruthy();
    expect(screen.getByText("The Trash Can is empty.")).toBeTruthy();
  });

  it("lists deleted notes and groups with how long each has left", () => {
    renderTrash();

    const notes = screen.getByRole("region", { name: "Notes" });
    expect(within(notes).getByText("Groceries")).toBeTruthy();
    expect(within(notes).getByText("Deleted permanently in 50 days")).toBeTruthy();
    // A blank title reads as the editor's "Untitled", and a nearly-expired item says so.
    expect(within(notes).getByText("Untitled")).toBeTruthy();
    expect(within(notes).getByText("Deleted permanently within a day")).toBeTruthy();
    const groups = screen.getByRole("region", { name: "Groups" });
    expect(within(groups).getByText("Old projects")).toBeTruthy();
    expect(within(groups).getByText("Deleted permanently in 59 days")).toBeTruthy();
  });

  it("restores a note and removes it from the list", async () => {
    renderTrash();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Groceries" }));
    });

    expect(restoreNote).toHaveBeenCalledWith(1);
    expect(screen.queryByText("Groceries")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Restored “Groceries”.");
  });

  it("restores a group", async () => {
    renderTrash();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Old projects" }));
    });

    expect(restoreGroup).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("region", { name: "Groups" })).toBeNull();
  });

  it("explains when a restored item came back at the top level", async () => {
    vi.mocked(restoreNote).mockResolvedValueOnce({ restoredToTopLevel: true });
    renderTrash();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Groceries" }));
    });

    expect(screen.getByRole("status").textContent).toMatch(/ungrouped note, because its group has been deleted/);
  });

  it("drops an item that is already gone and says so", async () => {
    vi.mocked(restoreNote).mockResolvedValueOnce({ error: "That item is no longer in the Trash Can." });
    renderTrash();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Groceries" }));
    });

    expect(screen.getByRole("alert").textContent).toBe("That item is no longer in the Trash Can.");
    expect(screen.queryByText("Groceries")).toBeNull();
  });

  it("asks before deleting for good, and deletes nothing if cancelled", async () => {
    renderTrash();

    fireEvent.click(screen.getByRole("button", { name: "Permanently delete Groceries" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Permanently delete “Groceries”?")).toBeTruthy();
    expect(permanentlyDeleteNote).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(permanentlyDeleteNote).not.toHaveBeenCalled();
    expect(screen.getByText("Groceries")).toBeTruthy();
  });

  it("deletes a note for good once confirmed", async () => {
    renderTrash();

    fireEvent.click(screen.getByRole("button", { name: "Permanently delete Groceries" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }));
    });

    expect(permanentlyDeleteNote).toHaveBeenCalledWith(1);
    expect(screen.queryByText("Groceries")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Permanently deleted “Groceries”.");
  });

  it("deletes a group for good once confirmed", async () => {
    renderTrash();

    fireEvent.click(screen.getByRole("button", { name: "Permanently delete Old projects" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete permanently" }));
    });

    expect(permanentlyDeleteGroup).toHaveBeenCalledWith(7);
    expect(screen.queryByText("Old projects")).toBeNull();
  });
});
