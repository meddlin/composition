// @vitest-environment jsdom
import { undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Decoration, EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveEditor } from "./LiveEditor";
import { listDecorations, toggleTask } from "./liveLists";
import { bodyStart, liveDecorations } from "./liveMarkdown";

afterEach(cleanup);

function stateOf(text: string, caret: number | [number, number]) {
  const [from, to] = typeof caret === "number" ? [caret, caret] : caret;
  const state = EditorState.create({ doc: text, selection: EditorSelection.range(from, to), extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

type Line = { line: number; class: string; style: string };
type Replaced = { from: number; to: number; text: string; widget: string; checked?: boolean };

/** What `listDecorations` does to `text` with the caret at `caret`: each line it styles, and each stretch it replaces. */
function decorate(text: string, caret: number | [number, number]): { lines: Line[]; replaced: Replaced[] } {
  const state = stateOf(text, caret);
  const found = listDecorations(state, [{ from: 0, to: text.length }], bodyStart(text));
  const lines: Line[] = [];
  const replaced: Replaced[] = [];
  for (const { from, to, value } of found as { from: number; to: number; value: Decoration }[]) {
    const spec = value.spec as { class?: string; attributes?: { style: string }; widget?: { constructor: { name: string }; checked?: boolean; text?: string } };
    if (spec.attributes) lines.push({ line: state.doc.lineAt(from).number, class: spec.class ?? "", style: spec.attributes.style });
    else replaced.push({ from, to, text: text.slice(from, to), widget: spec.widget?.constructor.name ?? "", ...(spec.widget && "checked" in spec.widget ? { checked: spec.widget.checked } : {}) });
  }
  return { lines: lines.sort((a, b) => a.line - b.line), replaced: replaced.sort((a, b) => a.from - b.from) };
}

const padding = (style: string) => /padding-left: ([^;]+)/.exec(style)?.[1];
const bars = (style: string) => (/background-position: ([^;]+)/.exec(style)?.[1] ?? "").split(", ").filter(Boolean).length;

describe("bullet lists", () => {
  const list = "- one\n- two\n  - nested\n    - deeper\n\nafter";

  it("draws each item's mark as a bullet, with its indentation hidden, away from the caret", () => {
    const { replaced } = decorate(list, list.length);
    expect(replaced.map(({ text, widget }) => [text, widget])).toEqual([
      ["- ", "ListMarkerWidget"],
      ["- ", "ListMarkerWidget"],
      ["  - ", "ListMarkerWidget"],
      ["    - ", "ListMarkerWidget"],
    ]);
  });

  it("indents each level one step further, and hangs the item's wrapped rows under its text", () => {
    const { lines } = decorate(list, list.length);
    expect(lines.map(({ line }) => line)).toEqual([1, 2, 3, 4]);
    expect(lines.map(({ style }) => padding(style))).toEqual(["calc(2em)", "calc(2em)", "calc(2em + 2em)", "calc(2em + 2em + 2em)"]);
    for (const { style, class: name } of lines) {
      expect(style).toContain("text-indent: -2em");
      expect(name).toContain("cm-live-list");
    }
  });

  it("shows the marks as written on the caret's line, and only there", () => {
    const { replaced, lines } = decorate(list, 8);
    expect(replaced.map(({ text }) => text)).toEqual(["- ", "  - ", "    - "]);
    // The line keeps its indent, so it does not jump as the caret arrives.
    expect(padding(lines[1].style)).toBe("calc(2em)");
  });

  it("shows the marks of every line a selection reaches", () => {
    expect(decorate(list, [2, 14]).replaced.map(({ text }) => text)).toEqual(["    - "]);
  });

  it.each(["*", "+"])("draws a %s item as a bullet too", (mark) => {
    expect(decorate(`${mark} item\n\nafter`, 10).replaced).toEqual([{ from: 0, to: 2, text: `${mark} `, widget: "ListMarkerWidget" }]);
  });

  it("hides a continued line's indentation up to the item's text, and no further", () => {
    const text = "- item\n  carried on\n\n  second paragraph\n\nafter";
    const { replaced, lines } = decorate(text, text.length);
    expect(replaced.map(({ text: hid, widget }) => [hid, widget])).toEqual([
      ["- ", "ListMarkerWidget"],
      ["  ", ""],
      ["  ", ""],
    ]);
    // The continued lines are indented to the text, but do not hang (they have no bullet).
    expect(lines.filter(({ line }) => line !== 1).every(({ style }) => !style.includes("text-indent"))).toBe(true);
  });

  it("leaves a list in the frontmatter alone", () => {
    expect(decorate("---\ntags:\n- a\n---\nbody", 22)).toEqual({ lines: [], replaced: [] });
  });
});

describe("ordered lists", () => {
  it("keeps each item's number as written", () => {
    const text = "1. one\n3. three\n7) seven\n\nafter";
    const state = stateOf(text, text.length);
    const markers = listDecorations(state, [{ from: 0, to: text.length }], 0)
      .map(({ value }) => (value.spec as { widget?: { text: string; ordered: boolean } }).widget)
      .filter((widget) => widget !== undefined);
    expect(markers.map(({ text: number, ordered }) => [number, ordered])).toEqual([
      ["1.", true],
      ["3.", true],
      ["7)", true],
    ]);
  });
});

describe("task lists", () => {
  const tasks = "- [ ] to do\n- [x] done\n- [X] done too\n\nafter";

  it("draws each [ ] and [x] as a checkbox, ticked or not, after the item's bullet", () => {
    const { replaced } = decorate(tasks, tasks.length);
    expect(replaced.filter(({ widget }) => widget === "TaskWidget").map(({ text, checked }) => [text, checked])).toEqual([
      ["[ ] ", false],
      ["[x] ", true],
      ["[X] ", true],
    ]);
    expect(replaced.filter(({ widget }) => widget === "ListMarkerWidget")).toHaveLength(3);
  });

  it("shows the source on the caret's line", () => {
    const { replaced } = decorate(tasks, 3);
    expect(replaced.map(({ text }) => text)).toEqual(["- ", "[x] ", "- ", "[X] "]);
  });

  it("toggles the x in the source, and nothing else", () => {
    const state = stateOf(tasks, tasks.length);
    const tick = state.update(toggleTask(state, 2)!).state;
    expect(tick.doc.toString()).toBe(tasks.replace("[ ] to do", "[x] to do"));
    const untick = tick.update(toggleTask(tick, 14)!).state;
    expect(untick.doc.toString().startsWith("- [x] to do\n- [ ] done\n")).toBe(true);
    expect(tick.update(toggleTask(tick, 25)!).state.doc.toString()).toContain("- [ ] done too");
    expect(toggleTask(state, 0)).toBeNull();
  });
});

describe("quotes", () => {
  it("draws a bar and an indent down the quote's lines, lazy ones included, and hides the > away from the caret", () => {
    const text = "> first\n> second\nlazy\n\nafter";
    const { lines, replaced } = decorate(text, text.length);
    expect(lines.map(({ line }) => line)).toEqual([1, 2, 3]);
    for (const { style, class: name } of lines) {
      expect(name).toContain("cm-live-quote");
      expect(padding(style)).toBe("calc((0.25rem + 1.25em))");
      expect(bars(style)).toBe(1);
    }
    expect(replaced.map(({ text: hid, widget }) => [hid, widget])).toEqual([
      ["> ", "SourceWidget"],
      ["> ", "SourceWidget"],
    ]);
    expect(decorate(text, 3).replaced.map(({ text: hid }) => hid)).toEqual(["> "]);
  });

  it("draws one bar for each level", () => {
    const text = "> outer\n> > inner\n\nafter";
    const { lines, replaced } = decorate(text, text.length);
    expect(lines.map(({ style }) => bars(style))).toEqual([1, 2]);
    expect(replaced.map(({ text: hid }) => hid)).toEqual(["> ", "> > "]);
  });

  it("puts a quote inside a list item at the item's text, and a list inside a quote after the bar", () => {
    const quoteInList = "- item\n  > quoted\n\nafter";
    const inner = decorate(quoteInList, quoteInList.length);
    expect(inner.lines[1].style).toContain("background-position: calc(2em) 0");
    expect(inner.replaced.map(({ text }) => text)).toEqual(["- ", "  > "]);

    const listInQuote = "> - item\n> - next\n\nafter";
    const outer = decorate(listInQuote, listInQuote.length);
    expect(padding(outer.lines[0].style)).toBe("calc((0.25rem + 1.25em) + 2em)");
    expect(outer.lines[0].style).toContain("background-position: 0px 0");
    expect(outer.replaced.map(({ text, widget }) => [text, widget])).toEqual([
      ["> - ", "ListMarkerWidget"],
      ["> - ", "ListMarkerWidget"],
    ]);
  });
});

describe("in liveDecorations", () => {
  it("is part of what the live editor draws", () => {
    const text = "- item\n\nafter";
    const state = stateOf(text, text.length);
    const set = liveDecorations(state, [{ from: 0, to: text.length }], 0);
    const classes: string[] = [];
    set.between(0, text.length, (_from, _to, value) => {
      classes.push(String(value.spec.class ?? value.spec.widget?.constructor.name));
    });
    expect(classes).toContain("cm-live-block cm-live-list");
    expect(classes).toContain("ListMarkerWidget");
  });
});

/** The live editor, rendered, with its view. */
function liveEditor(value: string) {
  let view: EditorView | null = null;
  let latest = value;
  const result = render(<LiveEditor value={value} onChange={(text) => (latest = text)} onView={(v) => (view = v)} />);
  return { ...result, view: () => view!, text: () => latest };
}

describe("ticking a box in the editor", () => {
  it("toggles the source on a click, as one undo step, with the caret left where it was", () => {
    const editor = liveEditor("- [ ] buy milk\n\nlast line");
    const view = editor.view();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    // Typing just before the click must not join its undo step.
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" }, selection: { anchor: view.state.doc.length + 1 }, userEvent: "input.type" });
    const caret = view.state.selection.main.head;

    const box = editor.container.querySelector<HTMLElement>(".cm-live-task")!;
    expect(box.getAttribute("role")).toBe("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(box.textContent).toBe("[ ]");
    fireEvent.mouseDown(box, { button: 0 });

    expect(view.state.doc.toString()).toBe("- [x] buy milk\n\nlast line!");
    expect(editor.text()).toBe("- [x] buy milk\n\nlast line!");
    expect(view.state.selection.main.head).toBe(caret);
    const ticked = editor.container.querySelector<HTMLElement>(".cm-live-task")!;
    expect(ticked.getAttribute("aria-checked")).toBe("true");

    undo(view);
    expect(view.state.doc.toString()).toBe("- [ ] buy milk\n\nlast line!");
    undo(view);
    expect(view.state.doc.toString()).toBe("- [ ] buy milk\n\nlast line");
  });

  it("does nothing in a note that can't be changed", () => {
    let view: EditorView | null = null;
    const { container } = render(<LiveEditor value={"- [ ] task\n\nend"} onChange={() => {}} onView={(v) => (view = v)} readOnly />);
    view!.dispatch({ selection: { anchor: view!.state.doc.length } });
    fireEvent.mouseDown(container.querySelector(".cm-live-task")!, { button: 0 });
    expect(view!.state.doc.toString()).toBe("- [ ] task\n\nend");
  });
});

describe("Enter in a list or a quote", () => {
  /** Puts the caret at `at` (the end, by default) and presses Enter. */
  function enter(text: string, at = text.length) {
    const editor = liveEditor(text);
    const view = editor.view();
    view.dispatch({ selection: { anchor: at } });
    fireEvent.keyDown(view.contentDOM, { key: "Enter" });
    return { text: view.state.doc.toString(), caret: view.state.selection.main.head };
  }

  it("continues a bullet list", () => {
    expect(enter("- one").text).toBe("- one\n- ");
  });

  it("continues an ordered list with the next number", () => {
    expect(enter("1. one").text).toBe("1. one\n2. ");
  });

  it("continues a task list with an empty box", () => {
    expect(enter("- [x] done").text).toBe("- [x] done\n- [ ] ");
  });

  it("continues a nested item at its own level", () => {
    expect(enter("- one\n  - nested").text).toBe("- one\n  - nested\n  - ");
  });

  it("ends the list on an empty item", () => {
    // The empty item's mark goes, and the caret stays on the now empty line, out of the list.
    expect(enter("- one\n- two\n- ")).toEqual({ text: "- one\n- two\n", caret: 12 });
    // An empty nested item steps out to the level above.
    expect(enter("- one\n  - a\n  - b\n  - ").text).toBe("- one\n  - a\n  - b\n- ");
  });

  it("makes a tight list loose on an empty second item, and ends it on the next Enter (CodeMirror's rule)", () => {
    const editor = liveEditor("- one\n- ");
    const view = editor.view();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    fireEvent.keyDown(view.contentDOM, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("- one\n\n- ");
    fireEvent.keyDown(view.contentDOM, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("- one\n\n");
  });

  it("continues a quote", () => {
    expect(enter("> quoted").text).toBe("> quoted\n> ");
  });
});
