// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listImages } from "@/lib/composition/client";
import type { ImageInfo } from "@/lib/composition/api";
import { MarkdownEditor } from "./MarkdownEditor";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn(), listImages: vi.fn() }));

const image = (name: string, usedIn = 0): ImageInfo => ({
  name,
  size: 2048,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  usedIn: Array.from({ length: usedIn }, (_, id) => ({ id, title: "n" })),
});

// Newest first, as the service returns them.
const stored = [
  image("trip-plan-route-map-111111111111.png", 1),
  image("groceries-image-222222222222.jpg"),
  image("trip-plan-image-333333333333.png"),
];

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <MarkdownEditor noteId={7} value={value} onChange={setValue} ratio={0.5} onRatioChange={vi.fn()} onRatioCommit={vi.fn()} />
  );
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
const menu = () => screen.queryByRole("listbox", { name: "Images" });
const names = () => screen.queryAllByRole("option").map((o) => o.querySelector(".font-mono")?.textContent);
const key = (name: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(editor(), { key: name, ...init });
const shortcut = () => key("M", { shiftKey: true, metaKey: true });

/** Opens the picker and lets the listing arrive. */
async function open() {
  shortcut();
  await act(async () => {});
}

function focusAt(value: string, start: number, end = start) {
  fireEvent.focus(editor());
  fireEvent.change(editor(), { target: { value, selectionStart: start, selectionEnd: end } });
  editor().setSelectionRange(start, end);
}

describe("MarkdownEditor image picker", () => {
  beforeEach(() => {
    vi.mocked(listImages).mockResolvedValue(stored);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists the stored images, newest first, when the shortcut is pressed", async () => {
    render(<Harness />);
    fireEvent.focus(editor());

    await open();

    expect(names()).toEqual(stored.map((i) => i.name));
    expect(screen.getAllByText("Not used in any note · 2 KB")).toHaveLength(2);
    expect(screen.getByText("Used in 1 note · 2 KB")).toBeTruthy();
  });

  it("also answers to Ctrl+Shift+M", async () => {
    render(<Harness />);
    fireEvent.focus(editor());

    key("M", { shiftKey: true, ctrlKey: true });
    await act(async () => {});

    expect(menu()).not.toBeNull();
  });

  it("lists the images afresh each time it opens", async () => {
    render(<Harness />);
    fireEvent.focus(editor());
    await open();
    key("Escape");

    await open();

    expect(listImages).toHaveBeenCalledTimes(2);
  });

  it("says it is loading until the listing arrives", async () => {
    let resolve: (images: ImageInfo[]) => void = () => {};
    vi.mocked(listImages).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Harness />);
    fireEvent.focus(editor());

    shortcut();
    expect(screen.getByText("Loading images…")).toBeTruthy();

    await act(async () => resolve(stored));
    expect(screen.queryByText("Loading images…")).toBeNull();
    expect(names()).toHaveLength(3);
  });

  it("says so when the images could not be listed", async () => {
    vi.mocked(listImages).mockRejectedValue(new Error("boom"));
    render(<Harness />);
    fireEvent.focus(editor());

    await open();

    expect(screen.getByText("Could not load the images.")).toBeTruthy();
  });

  it("says so when there are no images yet", async () => {
    vi.mocked(listImages).mockResolvedValue([]);
    render(<Harness />);
    fireEvent.focus(editor());

    await open();

    expect(screen.getByText("No images yet. Paste one into a note.")).toBeTruthy();
  });

  it("narrows the list by what is typed, without putting it in the note", async () => {
    render(<Harness initial="hello" />);
    focusAt("hello", 5);
    await open();

    key("g");
    key("r");

    expect(names()).toEqual(["groceries-image-222222222222.jpg"]);
    expect(editor().value).toBe("hello");

    key("Backspace");
    key("Backspace");
    expect(names()).toHaveLength(3);
  });

  it("says when nothing matches, and inserts nothing on Enter", async () => {
    render(<Harness />);
    fireEvent.focus(editor());
    await open();

    "zzz".split("").forEach((c) => key(c));
    key("Enter");

    expect(screen.getByText("No matching images")).toBeTruthy();
    expect(editor().value).toBe("");
    expect(menu()).not.toBeNull();
  });

  it("inserts the highlighted image as Markdown at the caret, with the caret after it", async () => {
    render(<Harness initial="see: " />);
    focusAt("see: ", 5);
    await open();

    key("ArrowDown");
    key("Enter");

    const markdown = "![groceries image](app_data/groceries-image-222222222222.jpg)";
    expect(editor().value).toBe(`see: ${markdown}`);
    expect(editor().selectionStart).toBe(`see: ${markdown}`.length);
    expect(menu()).toBeNull();
  });

  it("wraps from the top to the bottom with ArrowUp, and Tab inserts too", async () => {
    render(<Harness />);
    fireEvent.focus(editor());
    await open();

    key("ArrowUp");
    key("Tab");

    expect(editor().value).toBe("![trip plan image](app_data/trip-plan-image-333333333333.png)");
  });

  it("makes selected words the alt text and replaces them", async () => {
    render(<Harness initial="the big map here" />);
    focusAt("the big map here", 4, 11);
    await open();

    key("Enter");

    expect(editor().value).toBe("the ![big map](app_data/trip-plan-route-map-111111111111.png) here");
  });

  it("inserts the one that was clicked, and keeps focus in the editor", async () => {
    render(<Harness />);
    fireEvent.focus(editor());
    await open();

    const [option] = screen.getAllByRole("option").slice(2);
    expect(fireEvent.mouseDown(option)).toBe(false); // preventDefault: the textarea keeps focus.
    fireEvent.mouseUp(editor()); // (the option is gone by now)
    // A click ends; React's select handling ignores selections until it does.

    expect(editor().value).toBe("![trip plan image](app_data/trip-plan-image-333333333333.png)");
  });

  it("closes on Escape and on the shortcut again, leaving the text as it was", async () => {
    render(<Harness initial="abc" />);
    focusAt("abc", 3);
    await open();
    key("Escape");
    expect(menu()).toBeNull();

    await open();
    shortcut();
    expect(menu()).toBeNull();
    expect(editor().value).toBe("abc");
  });

  it("closes when the caret moves elsewhere, or the editor loses focus", async () => {
    render(<Harness initial="abc" />);
    focusAt("abc", 3);
    await open();
    fireEvent.focus(editor());
    // React reports a selection only when it differs from the last one it saw, so no other test uses this range.
    editor().setSelectionRange(1, 2);
    fireEvent.select(editor());
    expect(menu()).toBeNull();

    await open();
    fireEvent.blur(editor());
    expect(menu()).toBeNull();
  });

  it("ignores a listing that arrives after it was closed", async () => {
    let resolve: (images: ImageInfo[]) => void = () => {};
    vi.mocked(listImages).mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Harness />);
    fireEvent.focus(editor());
    shortcut();
    key("Escape");

    await act(async () => resolve(stored));

    expect(menu()).toBeNull();
  });

  it("announces its shortcut next to the note link one, and points at its list while open", async () => {
    render(<Harness />);
    fireEvent.focus(editor());
    expect(editor().getAttribute("aria-keyshortcuts")).toContain("Control+Shift+K Meta+Shift+K Control+Shift+M Meta+Shift+M");

    await open();

    expect(editor().getAttribute("aria-controls")).toBe(menu()?.id);
    expect(editor().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
  });

  it("does not take over typing, or Enter, while closed", () => {
    render(<Harness />);
    fireEvent.focus(editor());

    const notPrevented = fireEvent.keyDown(editor(), { key: "Enter" });

    expect(notPrevented).toBe(true);
    expect(menu()).toBeNull();
  });
});
