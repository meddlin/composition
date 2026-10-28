// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceStore } from "@/components/notes/workspaceStore";
import type { TodoLook } from "@/lib/composition/todoLook";
import { loadTodoLook, saveTodoLook } from "@/lib/composition/todosClient";
import { TodoLookSettings } from "./TodoLookSettings.desktop";

vi.mock("@/lib/composition/todosClient", () => ({ loadTodoLook: vi.fn(), saveTodoLook: vi.fn() }));

// Radix's radio group measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const SAVED: TodoLook = { background: "grid", color: "#e4efe1" };

beforeEach(() => {
  vi.mocked(loadTodoLook).mockResolvedValue(SAVED);
  vi.mocked(saveTodoLook).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  delete window.__workspace;
  vi.clearAllMocks();
});

const radio = (name: string) => screen.getByRole("radio", { name });

describe("the to-do background settings", () => {
  it("shows the saved background", async () => {
    render(<TodoLookSettings />);

    await waitFor(() => expect(radio("Grid").getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("button", { name: "Sage" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("saves a pattern and a color as they are picked, keeping the other", async () => {
    render(<TodoLookSettings />);
    await waitFor(() => expect(radio("Grid").getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(radio("Dots"));
    await waitFor(() => expect(saveTodoLook).toHaveBeenLastCalledWith({ background: "dots", color: "#e4efe1" }));

    fireEvent.click(screen.getByRole("button", { name: "Navy" }));
    await waitFor(() => expect(saveTodoLook).toHaveBeenLastCalledWith({ background: "dots", color: "#14202b" }));

    fireEvent.click(screen.getByRole("button", { name: "Color scheme's own" }));
    await waitFor(() => expect(saveTodoLook).toHaveBeenLastCalledWith({ background: "dots", color: null }));
  });

  it("resets both to the default", async () => {
    render(<TodoLookSettings />);
    await waitFor(() => expect(radio("Grid").getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));

    await waitFor(() => expect(saveTodoLook).toHaveBeenLastCalledWith({ background: "notes", color: null }));
    expect(radio("Same as notes").getAttribute("aria-checked")).toBe("true");
  });

  it("goes through the workspace's to-do store when this window has one, so open panels change at once", async () => {
    const setLook = vi.fn(async () => ({}));
    window.__workspace = { store: { todos: { setLook } } as unknown as WorkspaceStore, writing: {} as never };
    render(<TodoLookSettings />);
    await waitFor(() => expect(radio("Grid").getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(radio("Plain"));

    await waitFor(() => expect(setLook).toHaveBeenCalledWith({ background: "plain", color: "#e4efe1" }));
    expect(saveTodoLook).not.toHaveBeenCalled();
  });

  it("puts the old choice back and says why when it cannot be saved", async () => {
    vi.mocked(saveTodoLook).mockRejectedValueOnce(new Error("The disk is full."));
    render(<TodoLookSettings />);
    await waitFor(() => expect(radio("Grid").getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(radio("Dots"));

    expect(await screen.findByText("The disk is full.")).toBeTruthy();
    expect(radio("Grid").getAttribute("aria-checked")).toBe("true");
  });
});
