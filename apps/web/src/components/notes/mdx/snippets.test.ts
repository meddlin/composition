import { describe, expect, it } from "vitest";
import { expandCompletion } from "./completions";
import { findSnippetTarget } from "./snippets";

const at = (text: string) => findSnippetTarget(text, text.length);

describe("findSnippetTarget", () => {
  it("offers every snippet after a bare slash", () => {
    const target = at("hello\n/");
    expect(target?.start).toBe(6);
    expect(target?.items.map((i) => i.name)).toContain("table");
  });

  it("filters by what was typed", () => {
    expect(at("/ta")?.items.map((i) => i.name)).toEqual(["table", "tasks"]);
    expect(at("/tab")?.items.map((i) => i.name)).toEqual(["table"]);
  });

  it("works after a space", () => {
    expect(at("see /tab")?.start).toBe(4);
  });

  it("stays quiet inside words, paths, and code fences", () => {
    expect(at("and/or")).toBeNull();
    expect(at("a /b/c")).toBeNull();
    expect(at("```\n/tab")).toBeNull();
  });

  it("expands the table into a working Markdown table", () => {
    const item = at("/table")!.items[0];
    const { text, caret } = expandCompletion(item);
    expect(text.split("\n")[1]).toBe("| --- | --- | --- |");
    expect(text.slice(caret)).toMatch(/^Column 1/);
  });
});
