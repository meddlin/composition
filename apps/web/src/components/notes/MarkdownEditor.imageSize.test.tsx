// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import { describeParity, typeMarked, type EditorDriver } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const options = () => screen.queryAllByRole("option").map((o) => o.textContent);
const convert = (editor: EditorDriver, init: KeyboardEventInit = {}) =>
  editor.press("X", { shiftKey: true, metaKey: true, ...init });

const IMAGE = "![Route map](app_data/trip-0123456789ab.png)";
const TAG = '<Image src="app_data/trip-0123456789ab.png" alt="Route map" />';

// Turning a Markdown image into <Image />, in the plain Markdown editor and the live one. (The preview is only
// showing beside the first, so what a width does to the picture is looked at there.)
describeParity("MarkdownEditor: turning a Markdown image into <Image />", (scenario) => {
  scenario("is announced on the editor, beside the note-link and image-picker ones", ({ render }) => {
    const editor = render();

    expect(editor.element().getAttribute("aria-keyshortcuts")).toBe(
      "Control+Shift+K Meta+Shift+K Control+Shift+M Meta+Shift+M Control+Shift+X Meta+Shift+X Control+Shift+D Meta+Shift+D Control+] Control+[ Control+B Meta+B Control+I Meta+I",
    );
  });

  scenario("converts the image at the caret with Cmd+Shift+X, leaving the caret ready for another prop", ({ render }) => {
    const editor = render({ initial: `before\n\n${IMAGE}\n\nafter` });
    editor.select(12, 12);

    convert(editor);

    expect(editor.text()).toBe(`before\n\n${TAG}\n\nafter`);
    expect(editor.caret()).toBe(`before\n\n${TAG}`.length - " />".length);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  scenario("also answers to Ctrl+Shift+X", ({ render }) => {
    const editor = render({ initial: IMAGE });
    editor.select(3, 3);

    convert(editor, { metaKey: false, ctrlKey: true });

    expect(editor.text()).toBe(TAG);
  });

  scenario("converts every image in a selection", ({ render }) => {
    const text = `${IMAGE}\n\nbetween\n\n![Two](https://example.com/b.png)`;
    const editor = render({ initial: text });
    editor.select(0, text.length);

    convert(editor);

    expect(editor.text()).toBe(`${TAG}\n\nbetween\n\n<Image src="https://example.com/b.png" alt="Two" />`);
  });

  scenario("says what to do, and changes nothing, when there is no image there", ({ render }) => {
    const editor = render({ initial: `plain text\n\n${IMAGE}` });
    editor.select(2, 2);

    convert(editor);

    expect(editor.text()).toBe(`plain text\n\n${IMAGE}`);
    expect(screen.getByRole("alert").textContent).toContain("Markdown image");
  });

  scenario("clears that note once the text changes", ({ render }) => {
    const editor = render({ initial: "nothing" });
    convert(editor);
    expect(screen.queryByRole("alert")).not.toBeNull();

    editor.type("something else");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  scenario("keeps the browser from also handling the keystroke", ({ render }) => {
    const editor = render({ initial: IMAGE });

    expect(convert(editor)).toBe(false); // fireEvent returns false when the default was prevented
  });

  for (const change of [{ shiftKey: false }, { altKey: true }, { metaKey: false }]) {
    scenario(`ignores the key with ${JSON.stringify(change)}`, ({ render }) => {
      const editor = render({ initial: IMAGE });
      editor.select(3, 3);

      convert(editor, change);

      expect(editor.text()).toBe(IMAGE);
    });
  }

  scenario("shows the converted image in the preview at its new width once one is typed", ({ render, mode }) => {
    const editor = render({ initial: IMAGE });
    editor.select(3, 3);
    convert(editor);

    editor.type(`${TAG.replace(" />", "")} width="50%" />`);

    expect(editor.text()).toBe('<Image src="app_data/trip-0123456789ab.png" alt="Route map" width="50%" />');
    if (mode === "markdown") {
      const img = screen.getByAltText("Route map") as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("/app_data/trip-0123456789ab.png");
      expect(img.style.width).toBe("50%");
    }
  });
});

describeParity("MarkdownEditor: completing <Image> props", (scenario) => {
  scenario("lists the props once there is a space after the tag's name", ({ render }) => {
    const editor = render();

    editor.type("<Image ");

    expect(screen.getByRole("listbox", { name: "Image props" })).toBeDefined();
    expect(options()).toEqual([
      expect.stringContaining("src"),
      expect.stringContaining("alt"),
      expect.stringContaining("title"),
      expect.stringContaining("width"),
    ]);
  });

  scenario("narrows as the prop is typed, and drops the ones the tag has", ({ render }) => {
    const editor = render();

    editor.type('<Image src="a.png" w');
    expect(options()).toEqual([expect.stringContaining("width")]);

    editor.type('<Image src="a.png" ');
    expect(options()).toEqual([expect.stringContaining("alt"), expect.stringContaining("title"), expect.stringContaining("width")]);
  });

  scenario("inserts the prop with the caret between its quotes, and then offers its values", ({ render }) => {
    const editor = render();
    editor.type("<Image ");

    editor.press("ArrowDown");
    editor.press("ArrowDown");
    editor.press("ArrowDown");
    editor.press("Enter");

    expect(editor.text()).toBe('<Image width=""');
    expect(editor.caret()).toBe('<Image width="'.length);
    expect(screen.getByRole("listbox", { name: "width values" })).toBeDefined();
    expect(options()).toEqual(expect.arrayContaining([expect.stringContaining("50%"), expect.stringContaining("400")]));
  });

  scenario("inserts the chosen width and moves the caret past the closing quote", ({ render }) => {
    const editor = render();
    typeMarked(editor, '<Image src="a.png" width="|" />');

    editor.press("ArrowDown");
    editor.press("Enter");

    expect(editor.text()).toBe('<Image src="a.png" width="50%" />');
    expect(editor.caret()).toBe('<Image src="a.png" width="50%"'.length);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  scenario("narrows the values as they are typed", ({ render }) => {
    const editor = render();

    typeMarked(editor, '<Image width="2|"');

    expect(options()).toEqual([expect.stringContaining("25%"), expect.stringContaining("200")]);
  });

  scenario("goes away on Escape and stays away while the same value is edited", ({ render }) => {
    const editor = render();
    typeMarked(editor, '<Image width="|"');

    editor.press("Escape");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  scenario("is picked with the mouse, too", ({ render }) => {
    const editor = render();
    typeMarked(editor, '<Image width="|"');

    fireEvent.mouseDown(screen.getByRole("option", { name: /400/ }));

    expect(editor.text()).toBe('<Image width="400"');
  });

  scenario("stays out of the way of an ordinary space", ({ render }) => {
    const editor = render();

    editor.type("some words in a sentence ");
    expect(screen.queryByRole("listbox")).toBeNull();

    editor.type("<Info> ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  scenario("still lists the components after a <", ({ render }) => {
    const editor = render();

    editor.type("<");

    expect(screen.getByRole("listbox", { name: "MDX components" })).toBeDefined();
  });

  scenario("takes you from the converted tag to a width in a few keystrokes", ({ render, mode }) => {
    const editor = render({ initial: IMAGE });
    editor.select(3, 3);
    convert(editor);

    // The caret sits at the end of the last prop; a space starts the next.
    const at = editor.caret();
    typeMarked(editor, `${editor.text().slice(0, at)} ${editor.text().slice(at)}`.replace(" />", "| />"));
    expect(options()).toEqual([expect.stringContaining("title"), expect.stringContaining("width")]);
    editor.press("ArrowDown");
    editor.press("Enter");
    // The values menu opens on its first entry rather than where the last highlight was.
    editor.press("Enter");

    expect(editor.text()).toBe(`${TAG.replace(" />", "")} width="25%" />`);
    if (mode === "markdown") expect((screen.getByAltText("Route map") as HTMLImageElement).style.width).toBe("25%");
  });
});
