import { describe, expect, it } from "vitest";
import { diagramRange, diagramTag, insertDiagram, isDrawioShortcut, replaceDiagramSrc } from "./drawioSrc";

const key = { key: "d", shiftKey: true, altKey: false, metaKey: true, ctrlKey: false };

describe("isDrawioShortcut", () => {
  it("is Cmd or Ctrl with Shift and D", () => {
    expect(isDrawioShortcut(key)).toBe(true);
    expect(isDrawioShortcut({ ...key, key: "D", metaKey: false, ctrlKey: true })).toBe(true);
  });

  it("is not D alone, without Shift, or with Alt", () => {
    expect(isDrawioShortcut({ ...key, metaKey: false })).toBe(false);
    expect(isDrawioShortcut({ ...key, shiftKey: false })).toBe(false);
    expect(isDrawioShortcut({ ...key, altKey: true })).toBe(false);
    expect(isDrawioShortcut({ ...key, key: "m" })).toBe(false);
  });
});

describe("diagramTag", () => {
  it("points at the stored file", () => {
    expect(diagramTag("flow-3f9c2a71b0de.png")).toBe('<Drawio src="app_data/flow-3f9c2a71b0de.png" alt="Diagram" />');
  });

  it("keeps characters that would end an attribute out of the alt text", () => {
    expect(diagramTag("a.png", 'Say "hi" <b>')).toBe('<Drawio src="app_data/a.png" alt="Say  hi   b " />');
  });
});

describe("diagramRange", () => {
  const text = "---\ntitle: A\n---\nBody text";
  const bodyStart = text.indexOf("Body");

  it("keeps a selection in the body", () => {
    expect(diagramRange(text, bodyStart + 2, bodyStart + 4, bodyStart)).toEqual({ start: bodyStart + 2, end: bodyStart + 4 });
    expect(diagramRange(text, bodyStart, bodyStart, bodyStart)).toEqual({ start: bodyStart, end: bodyStart });
  });

  it("goes to the end of the note when the caret is in the frontmatter, as in an editor nobody has clicked in", () => {
    expect(diagramRange(text, 0, 0, bodyStart)).toEqual({ start: text.length, end: text.length });
    expect(diagramRange(text, 5, bodyStart + 3, bodyStart)).toEqual({ start: text.length, end: text.length });
  });

  it("is the caret itself for a note with no frontmatter", () => {
    expect(diagramRange("Body", 0, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("insertDiagram", () => {
  const apply = (text: string, start: number, end: number) => {
    const edit = insertDiagram(text, start, end, "d.png");
    return { text: text.slice(0, edit.start) + edit.text + text.slice(edit.end), caret: edit.start + edit.caret };
  };
  const tag = '<Drawio src="app_data/d.png" alt="Diagram" />';

  it("goes in an empty note with room left to write below", () => {
    expect(apply("", 0, 0)).toEqual({ text: `${tag}\n\n`, caret: tag.length + 2 });
  });

  it("starts a paragraph of its own after text", () => {
    expect(apply("Intro", 5, 5).text).toBe(`Intro\n\n${tag}\n\n`);
    expect(apply("Intro\n", 6, 6).text).toBe(`Intro\n\n${tag}\n\n`);
    expect(apply("Intro\n\n", 7, 7).text).toBe(`Intro\n\n${tag}\n\n`);
  });

  it("splits a paragraph it lands in the middle of", () => {
    expect(apply("One Two", 4, 4).text).toBe(`One \n\n${tag}\n\nTwo`);
  });

  it("does not add blank lines that are already there", () => {
    expect(apply("A\n\nB", 3, 3).text).toBe(`A\n\n${tag}\n\nB`);
    // One newline follows the caret, so one is added: a blank line, not two.
    expect(apply("A\n\n\nB", 3, 3).text).toBe(`A\n\n${tag}\n\nB`);
  });

  it("replaces what is selected", () => {
    expect(apply("A\n\nold\n\nB", 3, 6).text).toBe(`A\n\n${tag}\n\nB`);
  });

  it("puts the caret after what it inserted", () => {
    const { text, caret } = apply("Intro", 5, 5);
    expect(text.slice(caret)).toBe("");
  });
});

describe("replaceDiagramSrc", () => {
  it("points a tag at the new file", () => {
    expect(replaceDiagramSrc('<Drawio src="app_data/a.png" alt="x" />', "a.png", "b.png")).toBe('<Drawio src="app_data/b.png" alt="x" />');
  });

  it("changes every tag that shows the file, whatever order the props are in or how they are quoted", () => {
    const text = "<Drawio alt='y' src='./app_data/a.png' width=\"50%\" />\n\ntext\n\n<Drawio\n  src=\"app_data/a.png\"\n/>";
    expect(replaceDiagramSrc(text, "a.png", "b.png")).toBe(text.replaceAll("a.png", "b.png"));
  });

  it("reads a quoted value whole, so a > in the alt text does not hide the src", () => {
    expect(replaceDiagramSrc('<Drawio alt="a > b" src="app_data/a.png" />', "a.png", "b.png")).toContain("app_data/b.png");
  });

  it("leaves other files, other kinds of reference and similar names alone", () => {
    const text = [
      '<Drawio src="app_data/other.png" />',
      '<Image src="app_data/a.png" />',
      "![x](app_data/a.png)",
      '<Drawio src="app_data/xa.png" />',
      '<Drawio src="app_data/a.png.bak" />',
    ].join("\n\n");
    expect(replaceDiagramSrc(text, "a.png", "b.png")).toBe(text);
  });

  it("leaves a tag in a code block, which is an example of one", () => {
    const text = '```mdx\n<Drawio src="app_data/a.png" />\n```\n\n<Drawio src="app_data/a.png" />';
    expect(replaceDiagramSrc(text, "a.png", "b.png")).toBe('```mdx\n<Drawio src="app_data/a.png" />\n```\n\n<Drawio src="app_data/b.png" />');
  });

  it("treats the name literally", () => {
    expect(replaceDiagramSrc('<Drawio src="app_data/a-b.png" />', "a.b.png", "c.png")).toBe('<Drawio src="app_data/a-b.png" />');
  });
});
