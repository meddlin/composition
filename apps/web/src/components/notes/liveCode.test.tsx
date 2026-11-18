// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { cleanup, render } from "@testing-library/react";
import { all, common, createLowlight } from "lowlight";
import rehypeHighlight from "rehype-highlight";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeDecorations, fenceLanguage, lowlightHighlight, type Highlight } from "./liveCode";
import { bodyStart } from "./liveMarkdown";
import { NoteMarkdown } from "./NoteMarkdown";

type Found = { from: number; to: number; kind: string };

const highlightJs = lowlightHighlight(createLowlight(common));

/** The editor's state for `text` with the caret at `caret` (or a selection `[from, to]`), parsed to the end. */
function stateOf(text: string, caret: number | [number, number]): EditorState {
  const [from, to] = typeof caret === "number" ? [caret, caret] : caret;
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.range(from, to),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  // `ensureSyntaxTree` parses on the side; a new state picks the finished tree up.
  return state.update({}).state;
}

/** What the code-block layer does to `text`: its line classes by line text, what it hides, and its colour marks. */
function decorate(text: string, caret: number | [number, number], highlight: Highlight | null = highlightJs, ranges?: { from: number; to: number }[]) {
  const state = stateOf(text, caret);
  const { decorations, wantsColour } = codeDecorations(state, ranges ?? [{ from: 0, to: state.doc.length }], bodyStart(text), highlight);
  const lines: Found[] = [];
  const hidden: Found[] = [];
  const marked: Found[] = [];
  decorations.between(0, state.doc.length, (from, to, value) => {
    const kind = (value.spec.class as string | undefined) ?? "";
    if (from === to) lines.push({ from, to, kind });
    else if (value.point) hidden.push({ from, to, kind });
    else marked.push({ from, to, kind });
  });
  /** Each line's classes, joined, against the line's text: what is drawn where. */
  const byLine = (line: string) => {
    const at = state.doc.toString().indexOf(line);
    const start = state.doc.lineAt(at).from;
    return [...new Set(lines.filter((found) => found.from === start).flatMap((found) => found.kind.split(" ")))].sort().join(" ");
  };
  const text_ = (found: Found) => state.sliceDoc(found.from, found.to);
  return { lines, hidden, marked, byLine, text: text_, wantsColour };
}

const js = "Before.\n\n```js\nconst a = 1;\nlet b = 2;\n```\n\nAfter.";

describe("a fenced block", () => {
  it("draws every line on the block background, with its fences collapsed while the caret is elsewhere", () => {
    const { byLine, hidden } = decorate(js, 0);
    expect(byLine("```js")).toBe("cm-live-codeblock-hidden");
    expect(byLine("const a")).toBe("cm-live-codeblock cm-live-codeblock-first");
    expect(byLine("let b")).toBe("cm-live-codeblock cm-live-codeblock-last");
    expect(byLine("```\n\nAfter")).toBe("cm-live-codeblock-hidden");
    expect(byLine("Before")).toBe("");
    expect(byLine("After")).toBe("");
    // Nothing is replaced: the fences are still the document's text, only drawn with no height.
    expect(hidden).toEqual([]);
  });

  it("shows both fences, dimmed, with the corners on them, while the caret is in the block", () => {
    const { byLine } = decorate(js, js.indexOf("a = 1"));
    expect(byLine("```js")).toBe("cm-live-codeblock cm-live-codeblock-fence cm-live-codeblock-first");
    expect(byLine("const a")).toBe("cm-live-codeblock");
    expect(byLine("let b")).toBe("cm-live-codeblock");
    expect(byLine("```\n\nAfter")).toBe("cm-live-codeblock cm-live-codeblock-fence cm-live-codeblock-last");
  });

  it("counts the caret on a fence, or a selection reaching into the block, as inside it", () => {
    expect(decorate(js, js.indexOf("```js")).byLine("```js")).toContain("cm-live-codeblock-fence");
    expect(decorate(js, js.indexOf("\n\nAfter")).byLine("```js")).toContain("cm-live-codeblock-fence");
    expect(decorate(js, [0, js.indexOf("const")]).byLine("```js")).toContain("cm-live-codeblock-fence");
    // The blank line after the block is not the block.
    expect(decorate(js, js.indexOf("\nAfter")).byLine("```js")).toBe("cm-live-codeblock-hidden");
  });

  it("gives a one-line block both corners", () => {
    const one = "```js\nx()\n```\n\nEnd";
    expect(decorate(one, one.length).byLine("x()")).toBe("cm-live-codeblock cm-live-codeblock-first cm-live-codeblock-last");
  });

  it("keeps the fences of an empty block, which has no code to show in their place", () => {
    const empty = "```js\n```\n\nEnd";
    const { byLine } = decorate(empty, empty.length);
    expect(byLine("```js")).toBe("cm-live-codeblock cm-live-codeblock-fence cm-live-codeblock-first");
  });

  it("treats a fence never closed as code to the end of the note", () => {
    const open = "```py\nx = 1\ny = 2";
    const { byLine } = decorate(open, 0);
    expect(byLine("```py")).toBe("cm-live-codeblock cm-live-codeblock-fence cm-live-codeblock-first");
    const away = "Top\n\n```py\nx = 1\ny = 2";
    expect(decorate(away, 0).byLine("```py")).toBe("cm-live-codeblock-hidden");
    expect(decorate(away, 0).byLine("y = 2")).toBe("cm-live-codeblock cm-live-codeblock-last");
  });

  it("leaves a block in the frontmatter alone", () => {
    const note = "---\ntitle: x\n---\n```js\nconst a = 1;\n```\n";
    const inYaml = "---\ntitle: |\n  ```js\n  x\n  ```\n---\nBody";
    expect(decorate(note, note.length).lines.length).toBeGreaterThan(0);
    expect(decorate(inYaml, inYaml.length).lines).toEqual([]);
  });
});

describe("an indented block", () => {
  const indented = "Text\n\n    first\n    second\n\nAfter";

  it("draws it as a block, its four-space indent hidden while the caret is elsewhere", () => {
    const { byLine, hidden, text } = decorate(indented, 0);
    expect(byLine("    first")).toBe("cm-live-codeblock cm-live-codeblock-first");
    expect(byLine("    second")).toBe("cm-live-codeblock cm-live-codeblock-last");
    expect(hidden.map(text)).toEqual(["    ", "    "]);
  });

  it("shows the indent while the caret is in the block", () => {
    expect(decorate(indented, indented.indexOf("second")).hidden).toEqual([]);
  });
});

describe("colours", () => {
  it("marks each run with the classes lowlight gives it", () => {
    const { marked, text, wantsColour } = decorate(js, 0);
    expect(wantsColour).toBe(true);
    expect(marked.map((found) => [found.kind, text(found)])).toEqual([
      ["hljs-keyword", "const"],
      ["hljs-number", "1"],
      ["hljs-keyword", "let"],
      ["hljs-number", "2"],
    ]);
  });

  it("leaves an untagged fence and an indented block plain, as Preview does, and asks for no highlighter", () => {
    const plain = "```\nconst a = 1;\n```\n\n    let b = 2;\n";
    const highlight = vi.fn(highlightJs);
    const { marked, wantsColour } = decorate(plain, plain.length, highlight);
    expect(marked).toEqual([]);
    expect(wantsColour).toBe(false);
    expect(highlight).not.toHaveBeenCalled();
  });

  it("leaves a language the highlighter does not know plain", () => {
    const unknown = "```notalanguage\nconst a = 1;\n```\n";
    const { marked, wantsColour } = decorate(unknown, unknown.length);
    expect(marked).toEqual([]);
    expect(wantsColour).toBe(true);
  });

  it("draws the block uncoloured until the highlighter has loaded, and says it wants it", () => {
    const { marked, lines, wantsColour } = decorate(js, 0, null);
    expect(marked).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
    expect(wantsColour).toBe(true);
  });

  it("highlights the code without a quote's marks or a list item's indent", () => {
    const highlight = vi.fn<Highlight>(() => []);
    decorate("> ```js\n> const a = 1;\n> a++\n> ```\n", 0, highlight);
    decorate("- item\n\n  ```js\n  const a = 1;\n  a++\n  ```\n", 0, highlight);
    expect(highlight.mock.calls).toEqual([
      ["js", "const a = 1;\na++"],
      ["js", "const a = 1;\na++"],
    ]);
  });

  it("marks a run that crosses lines (a block comment) line by line", () => {
    const comment = "```js\n/* one\n   two */\nx\n```\n";
    const { marked, text } = decorate(comment, comment.length);
    expect(marked.filter((found) => found.kind === "hljs-comment").map(text)).toEqual(["/* one", "   two */"]);
  });

  it("colours only what is inside the ranges given (what is on screen)", () => {
    const { marked, text } = decorate(js, 0, highlightJs, [{ from: js.indexOf("let"), to: js.indexOf("2;") + 2 }]);
    expect(marked.map(text)).toEqual(["let", "2"]);
  });

  it("highlights a block once while its text stays the same", () => {
    const lowlight = createLowlight(common);
    const spy = vi.spyOn(lowlight, "highlight");
    const highlight = lowlightHighlight(lowlight);
    decorate(js, 0, highlight);
    decorate(js, js.indexOf("a = 1"), highlight);
    decorate(js, js.length, highlight);
    expect(spy).toHaveBeenCalledTimes(1);
    decorate(js.replace("1", "10"), 0, highlight);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reads the language as remark does: the info string's first word", () => {
    expect(fenceLanguage("js")).toBe("js");
    expect(fenceLanguage(" python title=\"x.py\"")).toBe("python");
    expect(fenceLanguage("")).toBe("");
  });
});

describe("the same colours as Preview", () => {
  afterEach(cleanup);

  /** Each character of the code with the `hljs-*` classes on it, as Preview draws it (rehype-highlight over every language). */
  function previewColours(note: string): string[][] {
    const preview = rehypeHighlight({ languages: all, detect: false });
    const { container } = render(<NoteMarkdown body={note} rehypePlugins={[() => preview]} />);
    const out: string[][] = [];
    for (const code of container.querySelectorAll("pre code")) {
      const block: string[] = [];
      const walk = (node: Node, classes: string[]) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const drawn = classes.filter((name) => name !== "").sort().join(" ");
          for (let index = 0; index < (node.textContent ?? "").length; index++) block.push(drawn);
          return;
        }
        const element = node as Element;
        const own = element === code ? [] : [...element.classList];
        for (const child of node.childNodes) walk(child, [...classes, ...own]);
      };
      walk(code, []);
      // Preview's code ends with the line break before the closing fence.
      if (block.length > 0) block.pop();
      out.push(block);
    }
    return out.map((block) => block.map((classes) => classes.split(" ").sort().join(" ")));
  }

  /** The same, as Live draws it: the classes of the colour marks over each character of each block's code. */
  function liveColours(note: string): string[][] {
    const state = stateOf(note, 0);
    const { decorations } = codeDecorations(state, [{ from: 0, to: state.doc.length }], 0, lowlightHighlight(createLowlight(all)));
    const covering = (pos: number) => {
      const classes: string[] = [];
      decorations.between(pos, pos + 1, (from, to, value) => {
        if (from <= pos && to > pos && !value.point && from !== to) classes.push(...String(value.spec.class).split(" "));
      });
      return classes.sort().join(" ");
    };
    const out: string[][] = [];
    const doc = state.doc;
    for (let number = 1; number <= doc.lines; number++) {
      if (!doc.line(number).text.startsWith("```")) continue;
      const block: string[] = [];
      let inner = number + 1;
      for (; inner <= doc.lines && doc.line(inner).text !== "```"; inner++) {
        const code = doc.line(inner);
        if (inner > number + 1) block.push("");
        for (let pos = code.from; pos < code.to; pos++) block.push(covering(pos));
      }
      out.push(block);
      number = inner;
    }
    return out;
  }

  it("colours JavaScript, Python and shell character for character as Preview does, and an untagged fence not at all", () => {
    const note = [
      "```js",
      "// greet someone",
      "function greet(name) {",
      "  const n = 42;",
      "  return `Hello, ${name}!`;",
      "}",
      "```",
      "",
      "```python",
      "def area(r: float) -> float:",
      '    """Circle area."""',
      "    return 3.14159 * r ** 2  # approx",
      "```",
      "",
      "```sh",
      "#!/bin/sh",
      'for f in *.md; do echo "$f"; done',
      "```",
      "",
      "```",
      "plain text",
      "```",
      "",
    ].join("\n");
    const live = liveColours(note);
    expect(live).toEqual(previewColours(note));
    expect(live[0].some((classes) => classes.includes("hljs-keyword"))).toBe(true);
    expect(live[3].every((classes) => classes === "")).toBe(true);
  });
});
