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

describe("SearchBar results found in a PDF's own text", () => {
  it("says on which page, and opens there with the query's words to find", async () => {
    vi.mocked(searchNotes).mockResolvedValueOnce({
      hits: [
        { id: 1, title: "Coastal birds", description: "", groupPath: [] },
        { id: 2, title: "Field guide", description: "", groupPath: [], pdf: { page: 3, label: "1" } },
        { id: 3, title: "Search fixture", description: "", groupPath: [], pdf: { page: 6, label: null } },
      ],
    });
    const onSelect = vi.fn();
    render(<SearchBar onSelect={onSelect} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Search notes" }), { target: { value: "the estuary tag: birds" } });

    await waitFor(() => expect(screen.getByText("In the PDF, p. 1")).toBeTruthy(), { timeout: SEARCH_DEBOUNCE_MS * 4 });
    expect(screen.getByText("In the PDF, p. 6")).toBeTruthy();
    expect(screen.getAllByText(/In the PDF/)).toHaveLength(2);

    fireEvent.click(screen.getByText("Field guide"));
    expect(onSelect).toHaveBeenCalledWith(2, { page: 3, find: "estuary" });
  });

  it("opens a note found by its own text as before", async () => {
    vi.mocked(searchNotes).mockResolvedValueOnce({ hits: [{ id: 1, title: "Coastal birds", description: "", groupPath: [] }] });
    const onSelect = vi.fn();
    render(<SearchBar onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search notes" }), { target: { value: "quetzals" } });
    await waitFor(() => expect(screen.getByText("Coastal birds")).toBeTruthy(), { timeout: SEARCH_DEBOUNCE_MS * 4 });
    fireEvent.click(screen.getByText("Coastal birds"));
    expect(onSelect).toHaveBeenCalledWith(1, undefined);
  });
});
