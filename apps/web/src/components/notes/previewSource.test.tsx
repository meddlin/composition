// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { alignText, SOURCE_ATTRIBUTE, sourceRangeOf } from "./previewSource";
import { NoteMarkdown } from "./NoteMarkdown";

afterEach(cleanup);

/** Renders a note and returns the preview's element. */
function preview(body: string) {
  const { container } = render(<NoteMarkdown body={body} rehypePlugins={[]} />);
  return container;
}

/** A DOM range over `needle`, which must sit inside one text node of the preview. */
function rangeOver(root: HTMLElement, needle: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const at = node.data.indexOf(needle);
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + needle.length);
    return range;
  }
  throw new Error(`${needle} is not in the preview`);
}

describe("alignText", () => {
  it("is the identity when the rendered text is the source", () => {
    expect(alignText("hello", "hello")).toEqual([0, 1, 2, 3, 4]);
  });

  it("steps over the backslash of an escape", () => {
    // `a\*b` renders as a*b; the * is the third character of the source.
    expect(alignText("a*b", String.raw`a\*b`)).toEqual([0, 2, 3]);
  });

  it("steps over a quote's > and a list's indent after a line break", () => {
    expect(alignText("one\ntwo", "one\n> two")).toEqual([0, 1, 2, 3, 6, 7, 8]);
    expect(alignText("\nmore", "\n  more")).toEqual([0, 3, 4, 5, 6]);
  });

  it("counts a character outside the BMP as the two units JavaScript indexes it by", () => {
    expect(alignText("a😀b", "a😀b")).toEqual([0, 1, 2, 3]);
    expect(alignText("😀 x", "😀  x")).toEqual([0, 1, 2, 4]);
  });

  it("steps over spaces the renderer trimmed before a line break", () => {
    expect(alignText("one\ntwo", "one  \ntwo")).toEqual([0, 1, 2, 5, 6, 7, 8]);
  });

  it("gives up on character references, whose length it can't know", () => {
    expect(alignText("a & b", "a &amp; b")).toBeNull();
  });

  it("gives up when text is missing from the source, or would be skipped over", () => {
    expect(alignText("abc", "ab")).toBeNull();
    expect(alignText("ab", "a#b")).toBeNull();
    expect(alignText("one two", "one\ntwo")).toBeNull();
  });
});

describe("sourceRangeOf", () => {
  it("maps a selection inside a paragraph to its place in the note", () => {
    const body = "Hello *there* big world";
    const root = preview(body);

    expect(sourceRangeOf(root, rangeOver(root, "big"), body)).toEqual({ ok: true, start: body.indexOf("big"), end: body.indexOf("big") + 3 });
  });

  it("maps a selection across formatting and blocks to the span they cover", () => {
    const body = "Hello **bold** text\n\nSecond paragraph";
    const root = preview(body);
    const range = document.createRange();
    range.setStart(rangeOver(root, "ello").startContainer, 1);
    const second = rangeOver(root, "Second");
    range.setEnd(second.endContainer, 3);

    const result = sourceRangeOf(root, range, body);

    expect(result).toEqual({ ok: true, start: 1, end: body.indexOf("Second") + 3 });
  });

  it("finds the text inside a quote, a tight list and an existing highlight", () => {
    const body = '> one\n> two\n\n- item `x`\n  more\n\n<Mark color="green">marked</Mark>';
    const root = preview(body);

    for (const needle of ["two", "more", "marked"]) {
      const result = sourceRangeOf(root, rangeOver(root, needle), body);
      expect(result.ok && body.slice(result.start, result.end)).toBe(needle);
    }
  });

  it("maps through an escape to the character itself", () => {
    const body = String.raw`snake\_case here`;
    const root = preview(body);

    const result = sourceRangeOf(root, rangeOver(root, "_case"), body);

    // The backslash is in the range or just before it; highlighting widens over it either way.
    expect(result.ok && body.slice(result.start, result.end)).toMatch(/_case$/);
  });

  it("says so when the selection holds no text a highlight can go around", () => {
    const body = "run `code` now\n\n```\nfenced\n```";
    const root = preview(body);

    expect(sourceRangeOf(root, rangeOver(root, "code"), body)).toEqual({ ok: false, reason: expect.stringContaining("code") });
    expect(sourceRangeOf(root, rangeOver(root, "fenced"), body)).toEqual({ ok: false, reason: expect.stringContaining("code") });
  });

  it("says so when the text is one it can't locate", () => {
    const body = "fish &amp; chips";
    const root = preview(body);

    expect(sourceRangeOf(root, rangeOver(root, "chips"), body)).toEqual({ ok: false, reason: expect.stringContaining("&") });
  });

  it("refuses a selection that leaves the preview", () => {
    const body = "one";
    const root = preview(body);
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.append(outside);
    const range = document.createRange();
    range.setStart(rangeOver(root, "one").startContainer, 0);
    range.setEnd(outside.firstChild!, 3);

    expect(sourceRangeOf(root, range, body).ok).toBe(false);
    outside.remove();
  });

  it("marks every piece of text with where it starts and ends, and nothing in code", () => {
    const root = preview("a *b* `c`\n\n```\nd\n```");

    const spans = [...root.querySelectorAll(`[${SOURCE_ATTRIBUTE}]`)].map((el) => [el.textContent, el.getAttribute(SOURCE_ATTRIBUTE)]);
    expect(spans).toEqual([
      ["a ", "0-2"],
      ["b", "3-4"],
    ]);
  });
});
