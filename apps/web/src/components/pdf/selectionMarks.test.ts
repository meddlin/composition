// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { marksFromSelection, rangeInPage, selectionAnchor, textOfRange, tidyQuote, type PageOnScreen } from "./selectionMarks";

// jsdom does no layout: the rectangle of a piece of text is whatever `data-box` on its span says ("left,top,right,bottom",
// relative to the page's content area), which the stubs below turn into client rectangles, as a browser would report them.
let frame = { left: 100, top: 50 };
beforeEach(() => {
  frame = { left: 100, top: 50 };
  Element.prototype.getBoundingClientRect = function () {
    const origin = (this as HTMLElement).dataset.page ? frame : { left: 0, top: 0 };
    return { left: origin.left, top: origin.top, right: origin.left + 612, bottom: origin.top + 792, width: 612, height: 792, x: origin.left, y: origin.top, toJSON() {} };
  };
  Object.defineProperty(HTMLElement.prototype, "clientLeft", { configurable: true, get: () => 9 });
  Object.defineProperty(HTMLElement.prototype, "clientTop", { configurable: true, get: () => 9 });
  Range.prototype.getClientRects = function () {
    const spans = Array.from((this.commonAncestorContainer.ownerDocument ?? document).querySelectorAll<HTMLElement>("[data-box]")).filter((s) => this.intersectsNode(s));
    const rects = spans.map((s) => {
      const [l, t, r, b] = s.dataset.box!.split(",").map(Number);
      const page = s.closest<HTMLElement>("[data-page]")!;
      const o = { x: frame.left + 9 + (page.dataset.page === "2" ? 0 : 0), y: frame.top + 9 };
      return { left: o.x + l, top: o.y + t, right: o.x + r, bottom: o.y + b, width: r - l, height: b - t, x: o.x + l, y: o.y + t, toJSON() {} };
    });
    return Object.assign(rects, { item: (i: number) => rects[i] }) as unknown as DOMRectList;
  };
});
afterEach(() => (document.body.innerHTML = ""));

/** A viewport at scale 1 for a 792 pt tall page: y is flipped, as pdf.js does. */
const viewport = { convertToViewportPoint: (x: number, y: number): [number, number] => [x, 792 - y], convertToPdfPoint: (x: number, y: number): [number, number] => [x, 792 - y] };

/** A page of the reader: spans of text with their boxes, and a `<br>` after those that end a line, as pdf.js writes its text layer. */
function build(pages: { number: number; spans: ([string, string] | [string, string, "eol"])[] }[]): PageOnScreen[] {
  document.body.innerHTML = pages
    .map((p) => `<div class="page" data-page="${p.number}" data-page-number="${p.number}"><div class="canvasWrapper"></div><div class="textLayer">${p.spans.map(([text, box, eol]) => `<span data-box="${box}">${text}</span>${eol ? "<br>" : ""}`).join("")}</div></div>`)
    .join("");
  return pages.map((p) => ({ pageNumber: p.number, element: document.querySelector<HTMLElement>(`[data-page="${p.number}"]`)!, viewport }));
}

function select(from: Node, fromOffset: number, to: Node, toOffset: number): Selection {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  selection.addRange(range);
  return selection;
}
const textOf = (page: number, index: number) => document.querySelectorAll(`[data-page="${page}"] .textLayer span`)[index].firstChild!;

describe("tidyQuote", () => {
  it("makes runs of spaces and line breaks one space and trims", () => {
    expect(tidyQuote("  one\n  two   three\t\nfour ")).toBe("one two three four");
  });
});

describe("textOfRange", () => {
  it("reads a line break as a space, where Range.toString() reads it as nothing", () => {
    build([{ number: 1, spans: [["first line", "0,0,10,10", "eol"], ["second line", "0,12,10,22"]] }]);
    const range = select(textOf(1, 0), 0, textOf(1, 1), 11).getRangeAt(0);

    expect(range.toString()).toBe("first linesecond line");
    expect(textOfRange(range)).toBe("first line second line");
  });
});

describe("marksFromSelection", () => {
  it("makes a mark of a line of text: its rectangle in raw space and the words as the quote", () => {
    const pages = build([{ number: 3, spans: [["Page 3 of the test book", "62,80,234,104"]] }]);
    const selection = select(textOf(3, 0), 0, textOf(3, 0), 23);

    expect(marksFromSelection(selection, pages, "highlight", "yellow")).toEqual([
      { page: 2, kind: "highlight", color: "yellow", rects: [[62, 688, 234, 712]], quote: "Page 3 of the test book" },
    ]);
  });

  it("makes one rectangle per line, merging the pieces of a line", () => {
    const pages = build([
      { number: 1, spans: [["First ", "10,100,60,112"], ["line", "62,100,110,112", "eol"], ["second line", "10,120,120,132"]] },
    ]);
    const selection = select(textOf(1, 0), 0, textOf(1, 2), 11);

    const [mark] = marksFromSelection(selection, pages, "underline", "green");

    expect(mark.rects).toEqual([[10, 680, 110, 692], [10, 660, 120, 672]]);
    expect(mark.quote).toBe("First line second line");
    expect(mark.kind).toBe("underline");
  });

  it("makes one mark per page for a selection that crosses pages, each with its own words", () => {
    const pages = build([
      { number: 4, spans: [["end of page four", "10,700,150,712"]] },
      { number: 5, spans: [["start of page five", "10,60,160,72"], ["unselected", "10,90,100,102"]] },
    ]);
    const selection = select(textOf(4, 0), 4, textOf(5, 0), 8);

    const marks = marksFromSelection(selection, pages, "highlight", "pink");

    expect(marks.map((m) => [m.page, m.quote])).toEqual([[3, "of page four"], [4, "start of"]]);
    expect(marks[0].rects).toHaveLength(1);
    expect(marks[1].rects).toHaveLength(1);
  });

  it("is empty when nothing is selected, or the selection is collapsed", () => {
    const pages = build([{ number: 1, spans: [["text", "10,100,50,112"]] }]);

    expect(marksFromSelection(null, pages, "highlight", "yellow")).toEqual([]);
    window.getSelection()!.removeAllRanges();
    expect(marksFromSelection(window.getSelection(), pages, "highlight", "yellow")).toEqual([]);
    expect(marksFromSelection(select(textOf(1, 0), 2, textOf(1, 0), 2), pages, "highlight", "yellow")).toEqual([]);
  });

  it("leaves out a page the selection touches only outside its text", () => {
    const pages = build([{ number: 1, spans: [["text", "10,100,50,112"]] }, { number: 2, spans: [["more", "10,100,50,112"]] }]);
    const outside = select(document.body, 0, document.body, 1);

    expect(marksFromSelection(outside, [pages[1]], "highlight", "yellow")).toEqual([]);
  });
});

describe("rangeInPage", () => {
  it("cuts a range at the page's text layer, and is null for a page it does not touch", () => {
    build([{ number: 1, spans: [["one", "0,0,10,10"]] }, { number: 2, spans: [["two", "0,0,10,10"]] }]);
    const first = document.querySelector('[data-page="1"] .textLayer')!;
    const second = document.querySelector('[data-page="2"] .textLayer')!;
    const range = select(textOf(1, 0), 1, textOf(2, 0), 2).getRangeAt(0);

    expect(rangeInPage(range, first)?.toString()).toBe("ne");
    expect(rangeInPage(range, second)?.toString()).toBe("tw");
    const only = select(textOf(1, 0), 0, textOf(1, 0), 3).getRangeAt(0);
    expect(rangeInPage(only, second)).toBeNull();
  });
});

describe("selectionAnchor", () => {
  it("says where the selection is, above and below it, so a toolbar can sit by it", () => {
    build([{ number: 1, spans: [["one line", "10,100,110,112"], ["next line", "10,120,90,132"]] }]);
    const selection = select(textOf(1, 0), 0, textOf(1, 1), 9);

    const anchor = selectionAnchor(selection)!;

    expect(anchor.top).toBe(50 + 9 + 100);
    expect(anchor.bottom).toBe(50 + 9 + 132);
    expect(anchor.x).toBeGreaterThan(100);
  });

  it("is null with no selection", () => {
    expect(selectionAnchor(null)).toBeNull();
  });
});
