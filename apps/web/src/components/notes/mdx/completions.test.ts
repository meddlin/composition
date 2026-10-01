import { describe, expect, it } from "vitest";
import { mdxComponents, usesMdxComponent } from "./components";
import { expandCompletion, findTrigger, matchCompletions, mdxCompletions } from "./completions";

describe("mdxCompletions", () => {
  it("offers exactly the allowed components", () => {
    expect(mdxCompletions.map((c) => c.name).sort()).toEqual(Object.keys(mdxComponents).sort());
  });

  it.each(mdxCompletions)("expands $name into a tag the preview recognises", (completion) => {
    const { text, caret } = expandCompletion(completion);
    expect(caret).toBeGreaterThanOrEqual(0);
    expect(text).not.toContain("$0");
    expect(usesMdxComponent(text)).toBe(true);
  });

  it("leaves the caret between the blank lines of a callout", () => {
    const { text, caret } = expandCompletion(mdxCompletions.find((c) => c.name === "Info")!);
    expect(text).toBe("<Info>\n\n\n\n</Info>");
    expect(text.slice(0, caret)).toBe("<Info>\n\n");
    expect(text.slice(caret)).toBe("\n\n</Info>");
  });

  it("leaves the caret inside the src of an image", () => {
    const { text, caret } = expandCompletion(mdxCompletions.find((c) => c.name === "Image")!);
    expect(text.slice(0, caret)).toBe('<Image src="');
    expect(text.slice(caret)).toBe('" alt="" />');
  });
});

describe("findTrigger", () => {
  const at = (text: string) => findTrigger(text, text.length);

  it("fires on a bare <", () => expect(at("<")).toEqual({ start: 0, query: "" }));
  it("carries what was typed after it", () => expect(at("hello <In")).toEqual({ start: 6, query: "In" }));
  it("fires on a later line", () => expect(at("one\n\n<Wa")).toEqual({ start: 5, query: "Wa" }));
  it("fires after punctuation", () => expect(at("(<")).toEqual({ start: 1, query: "" }));
  it("uses the caret, not the end of the text", () => {
    expect(findTrigger("<Inf rest", 4)).toEqual({ start: 0, query: "Inf" });
  });

  it.each(["a<", "a<b", "<<", "<Info>", "<Info ", "<In1", "no angle", "", "1 < 2 and"])("ignores %j", (text) => {
    expect(at(text)).toBeNull();
  });

  it("ignores a < inside a fenced code block", () => {
    expect(at("```html\n<")).toBeNull();
    expect(at("~~~\n<")).toBeNull();
  });

  it("fires again once the fence has closed", () => {
    expect(at("```\ncode\n```\n<")).toEqual({ start: 13, query: "" });
  });
});

describe("matchCompletions", () => {
  it("returns everything for a bare <", () => expect(matchCompletions("")).toEqual(mdxCompletions));
  it("matches a prefix, ignoring case", () => expect(matchCompletions("wa").map((c) => c.name)).toEqual(["Warning"]));
  it("returns nothing for an unknown name", () => expect(matchCompletions("div")).toEqual([]));
  it("does not match in the middle of a name", () => expect(matchCompletions("nfo")).toEqual([]));
});
