import { describe, expect, it } from "vitest";
import { changedSpan, reflowAtCaret } from "./reflowText";

const OPTIONS = { column: 20, keepTables: true };

/** Types at the end of `text` and returns what reflow makes of it (the text itself when it needs no change). */
function reflowed(text: string, options = OPTIONS) {
  return reflowAtCaret(text, text.length, options)?.text ?? text;
}

describe("reflowAtCaret", () => {
  it("leaves a line that fits alone", () => {
    expect(reflowAtCaret("twelve chars", 12, OPTIONS)).toBeNull();
    expect(reflowAtCaret("exactly twenty chars", 20, OPTIONS)).toBeNull();
  });

  it("breaks at the last space before the column", () => {
    expect(reflowed("the quick brown fox jumps")).toBe("the quick brown fox\njumps");
  });

  it("keeps the caret after the text it was after", () => {
    const text = "the quick brown fox jumps";
    expect(reflowAtCaret(text, text.length, OPTIONS)).toEqual({ text: "the quick brown fox\njumps", caret: 25 });
  });

  it("keeps the caret where it was when it sits before the break", () => {
    const text = "the quick brown fox jumps";
    expect(reflowAtCaret(text, 4, OPTIONS)?.caret).toBe(4);
  });

  it("moves a caret that was in the middle of the text after the break", () => {
    const text = "the quick brown fox jumps over";
    const edit = reflowAtCaret(text, text.indexOf("over"), OPTIONS)!;
    expect(edit.text).toBe("the quick brown fox\njumps over");
    expect(edit.text.slice(edit.caret)).toBe("over");
  });

  it("breaks as often as it takes", () => {
    expect(reflowed("aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii")).toBe("aaaa bbbb cccc dddd\neeee ffff gggg hhhh\niiii");
  });

  it("drops the spaces it breaks at", () => {
    expect(reflowed("the quick brown fox   jumps")).toBe("the quick brown fox\njumps");
  });

  it("only changes the line being typed", () => {
    const text = "short\nthe quick brown fox jumps\nanother line that is far too long for it";
    const caret = text.indexOf("jumps") + 5;
    expect(reflowAtCaret(text, caret, OPTIONS)?.text).toBe(
      "short\nthe quick brown fox\njumps\nanother line that is far too long for it",
    );
  });

  it("leaves one long word whole, and breaks after it once more follows", () => {
    expect(reflowed("https://example.com/a/very/long/address")).toBe("https://example.com/a/very/long/address");
    expect(reflowed("https://example.com/a/very/long/address ")).toBe("https://example.com/a/very/long/address ");
    expect(reflowed("https://example.com/a/very/long/address and")).toBe("https://example.com/a/very/long/address\nand");
  });

  it("does not start a line with spaces left behind at the end of the last one", () => {
    expect(reflowed("the quick brown fox ")).toBe("the quick brown fox ");
  });

  describe("indent", () => {
    it("keeps a paragraph's indent", () => {
      expect(reflowed("  the quick brown fox jumps")).toBe("  the quick brown\n  fox jumps");
    });

    it("aligns under the text of a bullet", () => {
      expect(reflowed("- the quick brown fox jumps")).toBe("- the quick brown\n  fox jumps");
    });

    it("aligns under the text of a numbered item", () => {
      expect(reflowed("12. the quick brown fox jumps")).toBe("12. the quick brown\n    fox jumps");
    });

    it("aligns under the text of a task, not its checkbox", () => {
      expect(reflowed("- [ ] the quick brown fox jumps")).toBe("- [ ] the quick\n  brown fox jumps");
    });

    it("keeps quote marks", () => {
      expect(reflowed("> the quick brown fox jumps")).toBe("> the quick brown\n> fox jumps");
      expect(reflowed("> > the quick brown fox jumps")).toBe("> > the quick brown\n> > fox jumps");
    });

    it("never breaks inside the marker itself", () => {
      expect(reflowed("-    unbroken-text-that-is-too-long")).toBe("-    unbroken-text-that-is-too-long");
    });
  });

  describe("lines it must not break", () => {
    it("headings", () => {
      expect(reflowed("## a heading that runs past the column")).toBe("## a heading that runs past the column");
    });

    it("HTML and JSX", () => {
      const tag = '<Image src="app_data/a.png" width={300} />';
      expect(reflowed(tag)).toBe(tag);
    });

    it("code fences and what is inside them", () => {
      const text = "```ts\nconst something = another thing entirely;";
      expect(reflowed(text)).toBe(text);
      expect(reflowed(`${text}\n\`\`\`\nthe quick brown fox jumps`)).toBe(`${text}\n\`\`\`\nthe quick brown fox\njumps`);
    });

    it("an unclosed tilde fence", () => {
      const text = "~~~\nthe quick brown fox jumps";
      expect(reflowed(text)).toBe(text);
    });

    it("frontmatter", () => {
      const inside = "---\ntitle: the quick brown fox jumps\n";
      expect(reflowed(inside)).toBe(inside);
      const closed = "---\ntitle: a\n---\nthe quick brown fox jumps";
      expect(reflowed(closed)).toBe("---\ntitle: a\n---\nthe quick brown fox\njumps");
    });

    it("indented code", () => {
      const text = "para\n\n    the quick brown fox jumps";
      expect(reflowed(text)).toBe(text);
    });

    it("but a nested list item is not indented code", () => {
      expect(reflowed("- a\n\n    - the quick brown fox jumps")).toBe("- a\n\n    - the quick\n      brown fox\n      jumps");
    });
  });

  describe("tables", () => {
    const table = "| name | what it is |\n| --- | --- |\n| the quick brown fox | jumps over |";

    it("are kept whole", () => {
      expect(reflowed(table)).toBe(table);
    });

    it("are kept whole from the first row, before the delimiter row exists", () => {
      expect(reflowed("| the quick brown fox | jumps over |")).toBe("| the quick brown fox | jumps over |");
    });

    it("are kept whole without leading pipes", () => {
      const bare = "name | what it is\n--- | ---\nthe quick brown fox | jumps over";
      expect(reflowed(bare)).toBe(bare);
    });

    it("are broken like any other line when asked", () => {
      expect(reflowed(table, { column: 20, keepTables: false })).toBe(
        "| name | what it is |\n| --- | --- |\n| the quick brown\nfox | jumps over |",
      );
    });

    it("do not make a prose line with a pipe in it a table", () => {
      expect(reflowed("the quick brown fox | jumps")).toBe("the quick brown fox\n| jumps");
    });

    it("end where the table does", () => {
      expect(reflowed(`${table}\n\nthe quick brown fox jumps`)).toBe(`${table}\n\nthe quick brown fox\njumps`);
    });
  });
});

describe("changedSpan", () => {
  it("finds the stretch that differs", () => {
    expect(changedSpan("the quick brown fox jumps", "the quick brown fox\njumps")).toEqual({
      start: 19,
      end: 20,
      insert: "\n",
    });
  });

  it("is empty for equal text", () => {
    expect(changedSpan("same", "same")).toEqual({ start: 4, end: 4, insert: "" });
  });
});
