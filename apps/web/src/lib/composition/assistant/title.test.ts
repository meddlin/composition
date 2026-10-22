import { describe, expect, it } from "vitest";
import { titleFromAnswer } from "./title";

describe("titleFromAnswer", () => {
  it("uses the first heading's text", () => {
    expect(titleFromAnswer("# My Plan\n\nBody text.")).toBe("My Plan");
  });

  it("skips blank lines, and takes the first line's text without its markup", () => {
    expect(titleFromAnswer("\n\n## Day two **ideas**\nx")).toBe("Day two ideas");
    expect(titleFromAnswer("- Buy milk\n- eggs")).toBe("Buy milk");
    expect(titleFromAnswer("3. Third step")).toBe("Third step");
    expect(titleFromAnswer("> A quoted line")).toBe("A quoted line");
    expect(titleFromAnswer("See the [Lisbon guide](https://example.com/lisbon) and `tram` times")).toBe(
      "See the Lisbon guide and tram times",
    );
  });

  it("keeps underscores that are part of a word, and drops the ones that mark emphasis", () => {
    expect(titleFromAnswer("Use snake_case names")).toBe("Use snake_case names");
    expect(titleFromAnswer("_Italic_ start and _another_.")).toBe("Italic start and another.");
  });

  it("skips a code fence's opening line", () => {
    expect(titleFromAnswer("```python\nprint(1)\n```")).toBe("print(1)");
  });

  it("keeps a title to 60 characters, ending in an ellipsis when it had to cut", () => {
    const long = "word ".repeat(30).trim();
    const title = titleFromAnswer(long);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("…")).toBe(true);
    expect(long.startsWith(title.slice(0, -1).trimEnd())).toBe(true);
    expect(titleFromAnswer("x".repeat(60))).toBe("x".repeat(60));
  });

  it("falls back to Untitled when there is no text", () => {
    for (const text of ["", "   \n  ", "```\n```", "#", "-"]) expect(titleFromAnswer(text)).toBe("Untitled");
  });
});
