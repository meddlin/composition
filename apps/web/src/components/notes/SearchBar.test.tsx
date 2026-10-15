// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchNotes } from "@/lib/composition/client";
import { SearchBar, SEARCH_DEBOUNCE_MS } from "./SearchBar";

vi.mock("@/lib/composition/client", () => ({
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

afterEach(cleanup);

describe("SearchBar keyboard shortcut", () => {
  it.each([
    ["Cmd+K", { metaKey: true }],
    ["Ctrl+K", { ctrlKey: true }],
  ])("%s focuses the search input and selects its text", (_label, modifier) => {
    render(<SearchBar onSelect={() => {}} />);
    const input = screen.getByRole<HTMLInputElement>("combobox", { name: "Search notes" });
    fireEvent.change(input, { target: { value: "hello" } });
    expect(document.activeElement).not.toBe(input);

    const notPrevented = fireEvent.keyDown(document.body, { key: "k", ...modifier });

    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  it("ignores a bare K and other modified combinations", () => {
    render(<SearchBar onSelect={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Search notes" });

    expect(fireEvent.keyDown(document.body, { key: "k" })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: "k", metaKey: true, shiftKey: true })).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });

  it("stops listening after unmount", () => {
    const { unmount } = render(<SearchBar onSelect={() => {}} />);
    unmount();
    expect(fireEvent.keyDown(document.body, { key: "k", metaKey: true })).toBe(true);
  });
});

describe("SearchBar results", () => {
  it("shows the group and sub-group each hit belongs to", async () => {
    vi.mocked(searchNotes).mockResolvedValueOnce({
      hits: [
        { id: 1, title: "Maintenance & Care", description: "", groupPath: ["Lawn Care"] },
        { id: 2, title: "Winterize", description: "", groupPath: ["Lawn Care", "Sprinklers"] },
        { id: 3, title: "Loose note", description: "", groupPath: [] },
      ],
    });
    render(<SearchBar onSelect={() => {}} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Search notes" }), {
      target: { value: "main" },
    });

    await waitFor(() => expect(screen.getByText("Lawn Care")).toBeTruthy(), {
      timeout: SEARCH_DEBOUNCE_MS * 4,
    });
    expect(screen.getByText("Lawn Care › Sprinklers")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});
