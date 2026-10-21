// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MarkdownEditor noteId={7} value={value} onChange={setValue} ratio={0.5} onRatioChange={vi.fn()} onRatioCommit={vi.fn()} />;
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);
const key = (name: string, init: object = {}) => fireEvent.keyDown(editor(), { key: name, ...init });
const convert = (init: object = {}) => key("X", { shiftKey: true, metaKey: true, ...init });

/** Types by replacing the text and leaving the caret (or selection) where `|` is; no `|` means the end. */
function type(marked: string) {
  const from = marked.indexOf("|");
  const value = marked.replace("|", "");
  fireEvent.focus(editor());
  fireEvent.change(editor(), { target: { value, selectionStart: from === -1 ? value.length : from, selectionEnd: from === -1 ? value.length : from } });
}

function select(start: number, end: number) {
  editor().setSelectionRange(start, end);
  fireEvent.select(editor());
}

const IMAGE = "![Route map](app_data/trip-0123456789ab.png)";
const TAG = '<Image src="app_data/trip-0123456789ab.png" alt="Route map" />';

describe("MarkdownEditor: turning a Markdown image into <Image />", () => {
  afterEach(cleanup);

  it("is announced on the editor, beside the note-link and image-picker ones", () => {
    render(<Harness />);

    expect(editor().getAttribute("aria-keyshortcuts")).toBe("Control+Shift+K Meta+Shift+K Control+Shift+M Meta+Shift+M Control+Shift+X Meta+Shift+X");
  });

  it("converts the image at the caret with Cmd+Shift+X, leaving the caret ready for another prop", () => {
    render(<Harness initial={`before\n\n${IMAGE}\n\nafter`} />);
    editor().setSelectionRange(12, 12);

    convert();

    expect(editor().value).toBe(`before\n\n${TAG}\n\nafter`);
    expect(editor().selectionStart).toBe(`before\n\n${TAG}`.length - " />".length);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("also answers to Ctrl+Shift+X", () => {
    render(<Harness initial={IMAGE} />);
    editor().setSelectionRange(3, 3);

    convert({ metaKey: false, ctrlKey: true });

    expect(editor().value).toBe(TAG);
  });

  it("converts every image in a selection", () => {
    const text = `${IMAGE}\n\nbetween\n\n![Two](https://example.com/b.png)`;
    render(<Harness initial={text} />);
    select(0, text.length);

    convert();

    expect(editor().value).toBe(`${TAG}\n\nbetween\n\n<Image src="https://example.com/b.png" alt="Two" />`);
  });

  it("says what to do, and changes nothing, when there is no image there", () => {
    render(<Harness initial={`plain text\n\n${IMAGE}`} />);
    editor().setSelectionRange(2, 2);

    convert();

    expect(editor().value).toBe(`plain text\n\n${IMAGE}`);
    expect(screen.getByRole("alert").textContent).toContain("Markdown image");
  });

  it("clears that note once the text changes", () => {
    render(<Harness initial="nothing" />);
    convert();
    expect(screen.queryByRole("alert")).not.toBeNull();

    type("something else");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the browser from also handling the keystroke", () => {
    render(<Harness initial={IMAGE} />);

    expect(convert()).toBe(false); // fireEvent returns false when the default was prevented
  });

  it.each([{ shiftKey: false }, { altKey: true }, { metaKey: false }])("ignores the key with %j", (change) => {
    render(<Harness initial={IMAGE} />);
    editor().setSelectionRange(3, 3);

    convert(change);

    expect(editor().value).toBe(IMAGE);
  });

  it("shows the converted image in the preview at its new width once one is typed", () => {
    render(<Harness initial={IMAGE} />);
    editor().setSelectionRange(3, 3);
    convert();

    type(`${TAG.replace(" />", "")} width="50%" />`);

    const img = screen.getByAltText("Route map") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/app_data/trip-0123456789ab.png");
    expect(img.style.width).toBe("50%");
  });
});

describe("MarkdownEditor: completing <Image> props", () => {
  afterEach(cleanup);

  it("lists the props once there is a space after the tag's name", () => {
    render(<Harness />);

    type("<Image ");

    expect(screen.getByRole("listbox", { name: "Image props" })).toBeDefined();
    expect(options()).toEqual([
      expect.stringContaining("src"),
      expect.stringContaining("alt"),
      expect.stringContaining("title"),
      expect.stringContaining("width"),
    ]);
  });

  it("narrows as the prop is typed, and drops the ones the tag has", () => {
    render(<Harness />);

    type('<Image src="a.png" w');
    expect(options()).toEqual([expect.stringContaining("width")]);

    type('<Image src="a.png" ');
    expect(options()).toEqual([expect.stringContaining("alt"), expect.stringContaining("title"), expect.stringContaining("width")]);
  });

  it("inserts the prop with the caret between its quotes, and then offers its values", () => {
    render(<Harness />);
    type("<Image ");

    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown");
    key("Enter");

    expect(editor().value).toBe('<Image width=""');
    expect(editor().selectionStart).toBe('<Image width="'.length);
    expect(screen.getByRole("listbox", { name: "width values" })).toBeDefined();
    expect(options()).toEqual(expect.arrayContaining([expect.stringContaining("50%"), expect.stringContaining("400")]));
  });

  it("inserts the chosen width and moves the caret past the closing quote", () => {
    render(<Harness />);
    type('<Image src="a.png" width="|" />');

    key("ArrowDown");
    key("Enter");

    expect(editor().value).toBe('<Image src="a.png" width="50%" />');
    expect(editor().selectionStart).toBe('<Image src="a.png" width="50%"'.length);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("narrows the values as they are typed", () => {
    render(<Harness />);

    type('<Image width="2|"');

    expect(options()).toEqual([expect.stringContaining("25%"), expect.stringContaining("200")]);
  });

  it("goes away on Escape and stays away while the same value is edited", () => {
    render(<Harness />);
    type('<Image width="|"');

    key("Escape");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("is picked with the mouse, too", () => {
    render(<Harness />);
    type('<Image width="|"');

    fireEvent.mouseDown(screen.getByRole("option", { name: /400/ }));

    expect(editor().value).toBe('<Image width="400"');
  });

  it("stays out of the way of an ordinary space", () => {
    render(<Harness />);

    type("some words in a sentence ");
    expect(screen.queryByRole("listbox")).toBeNull();

    type('<Info> ');
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("still lists the components after a <", () => {
    render(<Harness />);

    type("<");

    expect(screen.getByRole("listbox", { name: "MDX components" })).toBeDefined();
  });

  it("takes you from the converted tag to a width in a few keystrokes", () => {
    render(<Harness initial={IMAGE} />);
    editor().setSelectionRange(3, 3);
    convert();

    // The caret sits at the end of the last prop; a space starts the next.
    const at = editor().selectionStart;
    type(`${editor().value.slice(0, at)} ${editor().value.slice(at)}`.replace(" />", "| />"));
    expect(options()).toEqual([expect.stringContaining("title"), expect.stringContaining("width")]);
    key("ArrowDown");
    key("Enter");
    // The values menu opens on its first entry rather than where the last highlight was.
    key("Enter");

    expect(editor().value).toBe(`${TAG.replace(" />", "")} width="25%" />`);
    expect((screen.getByAltText("Route map") as HTMLImageElement).style.width).toBe("25%");
  });
});
