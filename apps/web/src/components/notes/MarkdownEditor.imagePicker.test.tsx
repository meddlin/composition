// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { listImages } from "@/lib/composition/client";
import type { ImageInfo } from "@/lib/composition/api";
import { describeParity, type EditorDriver } from "./parityHarness";

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

const menu = () => screen.queryByRole("listbox", { name: "Images" });
const names = () => screen.queryAllByRole("option").map((o) => o.querySelector(".font-mono")?.textContent);
const shortcut = (editor: EditorDriver) => editor.press("M", { shiftKey: true, metaKey: true });

/** Opens the picker and lets the listing arrive. */
async function open(editor: EditorDriver) {
  shortcut(editor);
  await act(async () => {});
}

/** Puts the caret (or the selection `start` to `end`) in `value`, as typing it and moving there would. */
function focusAt(editor: EditorDriver, value: string, start: number, end = start) {
  editor.type(value, start);
  if (end !== start) editor.select(start, end);
}

beforeEach(() => {
  vi.mocked(listImages).mockResolvedValue(stored);
});
afterEach(() => vi.clearAllMocks());

// The image picker, in the plain Markdown editor and the live one.
describeParity("MarkdownEditor image picker", (scenario) => {
  scenario("lists the stored images, newest first, when the shortcut is pressed", async ({ render }) => {
    const editor = render();
    editor.focus();

    await open(editor);

    expect(names()).toEqual(stored.map((i) => i.name));
    expect(screen.getAllByText("Not used in any note · 2 KB")).toHaveLength(2);
    expect(screen.getByText("Used in 1 note · 2 KB")).toBeTruthy();
  });

  scenario("also answers to Ctrl+Shift+M", async ({ render }) => {
    const editor = render();
    editor.focus();

    editor.press("M", { shiftKey: true, ctrlKey: true });
    await act(async () => {});

    expect(menu()).not.toBeNull();
  });

  scenario("lists the images afresh each time it opens", async ({ render }) => {
    const editor = render();
    editor.focus();
    await open(editor);
    editor.press("Escape");

    await open(editor);

    expect(listImages).toHaveBeenCalledTimes(2);
  });

  scenario("says it is loading until the listing arrives", async ({ render }) => {
    let resolve: (images: ImageInfo[]) => void = () => {};
    vi.mocked(listImages).mockReturnValue(new Promise((r) => (resolve = r)));
    const editor = render();
    editor.focus();

    shortcut(editor);
    expect(screen.getByText("Loading images…")).toBeTruthy();

    await act(async () => resolve(stored));
    expect(screen.queryByText("Loading images…")).toBeNull();
    expect(names()).toHaveLength(3);
  });

  scenario("says so when the images could not be listed", async ({ render }) => {
    vi.mocked(listImages).mockRejectedValue(new Error("boom"));
    const editor = render();
    editor.focus();

    await open(editor);

    expect(screen.getByText("Could not load the images.")).toBeTruthy();
  });

  scenario("says so when there are no images yet", async ({ render }) => {
    vi.mocked(listImages).mockResolvedValue([]);
    const editor = render();
    editor.focus();

    await open(editor);

    expect(screen.getByText("No images yet. Paste one into a note.")).toBeTruthy();
  });

  scenario("narrows the list by what is typed, without putting it in the note", async ({ render }) => {
    const editor = render({ initial: "hello" });
    focusAt(editor, "hello", 5);
    await open(editor);

    editor.press("g");
    editor.press("r");

    expect(names()).toEqual(["groceries-image-222222222222.jpg"]);
    expect(editor.text()).toBe("hello");

    editor.press("Backspace");
    editor.press("Backspace");
    expect(names()).toHaveLength(3);
  });

  scenario("says when nothing matches, and inserts nothing on Enter", async ({ render }) => {
    const editor = render();
    editor.focus();
    await open(editor);

    "zzz".split("").forEach((c) => editor.press(c));
    editor.press("Enter");

    expect(screen.getByText("No matching images")).toBeTruthy();
    expect(editor.text()).toBe("");
    expect(menu()).not.toBeNull();
  });

  scenario("inserts the highlighted image as Markdown at the caret, with the caret after it", async ({ render }) => {
    const editor = render({ initial: "see: " });
    focusAt(editor, "see: ", 5);
    await open(editor);

    editor.press("ArrowDown");
    editor.press("Enter");

    const markdown = "![groceries image](app_data/groceries-image-222222222222.jpg)";
    expect(editor.text()).toBe(`see: ${markdown}`);
    expect(editor.caret()).toBe(`see: ${markdown}`.length);
    expect(menu()).toBeNull();
  });

  scenario("wraps from the top to the bottom with ArrowUp, and Tab inserts too", async ({ render }) => {
    const editor = render();
    editor.focus();
    await open(editor);

    editor.press("ArrowUp");
    editor.press("Tab");

    expect(editor.text()).toBe("![trip plan image](app_data/trip-plan-image-333333333333.png)");
  });

  scenario("makes selected words the alt text and replaces them", async ({ render }) => {
    const editor = render({ initial: "the big map here" });
    focusAt(editor, "the big map here", 4, 11);
    await open(editor);

    editor.press("Enter");

    expect(editor.text()).toBe("the ![big map](app_data/trip-plan-route-map-111111111111.png) here");
  });

  scenario("inserts the one that was clicked, and keeps focus in the editor", async ({ render }) => {
    const editor = render();
    editor.focus();
    await open(editor);

    const [option] = screen.getAllByRole("option").slice(2);
    expect(fireEvent.mouseDown(option)).toBe(false); // preventDefault: the editor keeps focus.
    fireEvent.mouseUp(editor.element()); // (the option is gone by now)

    expect(editor.text()).toBe("![trip plan image](app_data/trip-plan-image-333333333333.png)");
  });

  scenario("closes on Escape and on the shortcut again, leaving the text as it was", async ({ render }) => {
    const editor = render({ initial: "abc" });
    focusAt(editor, "abc", 3);
    await open(editor);
    editor.press("Escape");
    expect(menu()).toBeNull();

    await open(editor);
    shortcut(editor);
    expect(menu()).toBeNull();
    expect(editor.text()).toBe("abc");
  });

  scenario("closes when the caret moves elsewhere, or the editor loses focus", async ({ render }) => {
    const editor = render({ initial: "abc" });
    focusAt(editor, "abc", 3);
    await open(editor);
    editor.focus();
    // React reports a selection only when it differs from the last one it saw, so no other test uses this range.
    editor.select(1, 2);
    expect(menu()).toBeNull();

    await open(editor);
    editor.blur();
    expect(menu()).toBeNull();
  });

  scenario("ignores a listing that arrives after it was closed", async ({ render }) => {
    let resolve: (images: ImageInfo[]) => void = () => {};
    vi.mocked(listImages).mockReturnValue(new Promise((r) => (resolve = r)));
    const editor = render();
    editor.focus();
    shortcut(editor);
    editor.press("Escape");

    await act(async () => resolve(stored));

    expect(menu()).toBeNull();
  });

  scenario("announces its shortcut next to the note link one, and points at its list while open", async ({ render }) => {
    const editor = render();
    editor.focus();
    expect(editor.element().getAttribute("aria-keyshortcuts")).toContain("Control+Shift+K Meta+Shift+K Control+Shift+M Meta+Shift+M");

    await open(editor);

    expect(editor.element().getAttribute("aria-controls")).toBe(menu()?.id);
    expect(editor.element().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
  });

  scenario("does not take over typing, or Enter, while closed", ({ render, mode }) => {
    const editor = render();
    editor.focus();

    if (mode === "markdown") {
      // The browser makes the new line in a textarea, so all there is to check is that nothing cancelled the key.
      expect(editor.press("Enter")).toBe(true);
    } else {
      // The live editor makes it itself.
      editor.press("Enter");
      expect(editor.text()).toBe("\n");
    }
    expect(menu()).toBeNull();
  });
});
