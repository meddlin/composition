// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { expect, vi } from "vitest";
import { describeParity } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const menu = () => screen.queryByRole("listbox", { name: "MDX components" });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

// Run against the plain Markdown editor and the live one, which share the menu.
describeParity("MarkdownEditor component completion", (scenario) => {
  scenario("lists the components after a <", ({ render }) => {
    const editor = render();

    editor.type("<");

    expect(options()).toEqual([
      expect.stringContaining("<Info>"),
      expect.stringContaining("<Warning>"),
      expect.stringContaining("<Image>"),
      expect.stringContaining("<Drawio>"),
      expect.stringContaining("<Toc>"),
      expect.stringContaining("<Mark>"),
      expect.stringContaining("<Footnotes>"),
      expect.stringContaining("<YouTube>"),
      expect.stringContaining("<Repo>"),
      expect.stringContaining("<Chart>"),
    ]);
  });

  scenario("narrows the list as the name is typed", ({ render }) => {
    const editor = render();

    editor.type("<wa");

    expect(options()).toEqual([expect.stringContaining("<Warning>")]);
  });

  scenario("closes when nothing matches", ({ render }) => {
    const editor = render();

    editor.type("<div");

    expect(menu()).toBeNull();
  });

  scenario("stays out of the way of an ordinary <", ({ render }) => {
    const editor = render();

    editor.type("1 <");
    expect(menu()).not.toBeNull();

    editor.type("a<");
    expect(menu()).toBeNull();
  });

  scenario("stays out of the way inside a fenced code block", ({ render }) => {
    const editor = render();

    editor.type("```html\n<");

    expect(menu()).toBeNull();
  });

  scenario("inserts the highlighted component on Enter, with the caret inside it", ({ render }) => {
    const editor = render();
    editor.type("<");

    editor.press("ArrowDown");
    editor.press("Enter");

    expect(editor.text()).toBe("<Warning>\n\n\n\n</Warning>");
    expect(editor.caret()).toBe("<Warning>\n\n".length);
    expect(menu()).toBeNull();
  });

  scenario("inserts on Tab, replacing what was typed after the <", ({ render }) => {
    const editor = render();
    editor.type("intro\n\n<In");

    editor.press("Tab");

    expect(editor.text()).toBe("intro\n\n<Info>\n\n\n\n</Info>");
  });

  scenario("types a tab on Tab when no menu is open, at the caret", ({ render }) => {
    const editor = render();
    editor.type("- one\n- two", "- one".length);

    const notCancelled = editor.press("Tab");

    expect(notCancelled).toBe(false);
    expect(editor.text()).toBe("- one\t\n- two");
    expect(editor.caret()).toBe("- one\t".length);
  });

  scenario("replaces a selection with the tab", ({ render }) => {
    const editor = render();
    editor.type("a-b");
    editor.select(1, 2);

    editor.press("Tab");

    expect(editor.text()).toBe("a\tb");
  });

  scenario("leaves Shift+Tab alone so focus can still leave the editor", ({ render }) => {
    const editor = render();
    editor.type("text");

    const notCancelled = editor.press("Tab", { shiftKey: true });

    expect(notCancelled).toBe(true);
    expect(editor.text()).toBe("text");
  });

  scenario("wraps from the first item to the last with ArrowUp", ({ render }) => {
    const editor = render();
    editor.type("<");

    editor.press("ArrowUp");
    editor.press("Enter");

    expect(editor.text()).toBe('<Chart type="bar">\n\n```csv\n\n```\n\n</Chart>');
    // Inside the fence, where the table goes.
    expect(editor.caret()).toBe('<Chart type="bar">\n\n```csv\n'.length);
  });

  scenario("inserts a component picked with the mouse", ({ render }) => {
    const editor = render();
    editor.type("text <");

    fireEvent.mouseDown(screen.getByRole("option", { name: /Info/ }));

    expect(editor.text()).toBe("text <Info>\n\n\n\n</Info>");
  });

  scenario("marks the highlighted option for assistive tech", ({ render }) => {
    const editor = render();
    editor.type("<");

    editor.press("ArrowDown");

    const warning = screen.getByRole("option", { name: /Warning/ });
    expect(warning.getAttribute("aria-selected")).toBe("true");
    expect(editor.element().getAttribute("aria-activedescendant")).toBe(warning.id);
    expect(editor.element().getAttribute("aria-controls")).toBe(menu()!.id);
  });

  scenario("closes on Escape and stays closed while the same tag is typed", ({ render }) => {
    const editor = render();
    editor.type("<");

    editor.press("Escape");
    expect(menu()).toBeNull();
    expect(editor.text()).toBe("<");

    editor.type("<I");
    expect(menu()).toBeNull();

    // A new tag asks again.
    editor.type("<I and <");
    expect(menu()).not.toBeNull();
  });

  scenario("leaves Enter alone when the menu is closed", ({ render, mode }) => {
    const editor = render();
    editor.type("plain");

    if (mode === "markdown") {
      // The browser makes the new line in a textarea, so all there is to check is that nothing cancelled the key.
      expect(editor.press("Enter")).toBe(true);
    } else {
      // The live editor makes it itself, as the menu would have had Enter for itself were it open.
      editor.press("Enter");
      expect(editor.text()).toBe("plain\n");
    }
  });

  scenario("closes when the editor loses focus", ({ render }) => {
    const editor = render();
    editor.type("<");
    expect(menu()).not.toBeNull();

    editor.blur();

    expect(menu()).toBeNull();
  });
});
