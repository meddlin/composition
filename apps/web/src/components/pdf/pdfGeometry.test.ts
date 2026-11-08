import { describe, expect, it } from "vitest";
import type { PdfAnnotation } from "@/lib/composition/documentsApi";
import { boxToRaw, boxesOf, markAt, mergeLines, paintFor, rawToBox, type Box, type PageViewportLike } from "./pdfGeometry";

/** A viewport for a 612 x 792 page at a scale, turned by `rotation` degrees, as pdf.js's `PageViewport` converts points. */
function viewport(scale: number, rotation: 0 | 90 | 180 | 270 = 0, width = 612, height = 792): PageViewportLike {
  const turned = rotation % 180 !== 0;
  const w = (turned ? height : width) * scale;
  const h = (turned ? width : height) * scale;
  return {
    convertToViewportPoint(x, y) {
      switch (rotation) {
        case 0: return [x * scale, (height - y) * scale];
        case 90: return [y * scale, x * scale];
        case 180: return [(width - x) * scale, y * scale];
        default: return [(height - y) * scale, (width - x) * scale];
      }
    },
    convertToPdfPoint(px, py) {
      switch (rotation) {
        case 0: return [px / scale, height - py / scale];
        case 90: return [py / scale, px / scale];
        case 180: return [width - px / scale, py / scale];
        default: return [width - py / scale, height - px / scale];
      }
    },
    // not part of the interface, used to check the page size below
    ...({ width: w, height: h } as object),
  };
}

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe("rawToBox and boxToRaw", () => {
  it("turn a stored rectangle into a box on the screen and back, at any zoom", () => {
    for (const scale of [0.5, 1, 1.5, 3]) {
      const v = viewport(scale);
      const b = rawToBox([72, 690, 300, 714], v);

      expect(b).toEqual({ left: 72 * scale, top: (792 - 714) * scale, right: 300 * scale, bottom: (792 - 690) * scale });
      expect(boxToRaw(b, v)).toEqual([72, 690, 300, 714]);
    }
  });

  it("keep a rectangle a rectangle when the page is turned by a quarter, and give the same one back", () => {
    for (const rotation of [90, 180, 270] as const) {
      const v = viewport(1.25, rotation);
      const raw: [number, number, number, number] = [100, 200, 250, 230];

      const back = boxToRaw(rawToBox(raw, v), v);

      for (let i = 0; i < 4; i++) expect(back[i]).toBeCloseTo(raw[i], 9);
    }
  });

  it("put a 90-degree page's rectangle where the rotated page draws it", () => {
    const b = rawToBox([100, 200, 250, 230], viewport(1, 90));

    expect(b).toEqual({ left: 200, top: 100, right: 230, bottom: 250 });
  });
});

describe("mergeLines", () => {
  it("makes one rectangle of the pieces of a line, and of the same words reported twice", () => {
    const line = mergeLines([box(10, 100, 60, 112), box(62, 100, 120, 112), box(10, 100, 120, 113), box(121, 101, 150, 112)]);

    expect(line).toEqual([box(10, 100, 150, 113)]);
  });

  it("keeps a rectangle for each line, from the top down", () => {
    const lines = mergeLines([box(10, 130, 200, 142), box(10, 100, 180, 112), box(10, 115, 190, 127)]);

    expect(lines).toEqual([box(10, 100, 180, 112), box(10, 115, 190, 127), box(10, 130, 200, 142)]);
  });

  it("keeps two columns on one line apart, so a highlight does not cross the gutter", () => {
    const lines = mergeLines([box(10, 100, 200, 112), box(260, 100, 450, 112)]);

    expect(lines).toEqual([box(10, 100, 200, 112), box(260, 100, 450, 112)]);
  });

  it("joins a larger piece to the line it overlaps (a heading's taller box)", () => {
    expect(mergeLines([box(10, 98, 100, 118), box(102, 102, 160, 114)])).toEqual([box(10, 98, 160, 118)]);
  });

  it("ignores empty and zero-width pieces", () => {
    expect(mergeLines([box(10, 10, 10, 20), box(10, 10, 50, 10), box(10, 100, 50, 112)])).toEqual([box(10, 100, 50, 112)]);
    expect(mergeLines([])).toEqual([]);
  });

  it("does not change what it is given", () => {
    const input = [box(10, 100, 60, 112), box(62, 100, 120, 112)];
    mergeLines(input);
    expect(input).toEqual([box(10, 100, 60, 112), box(62, 100, 120, 112)]);
  });
});

const mark = (id: number, over: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
  id, uuid: String(id).padStart(32, "0"), documentId: 1, page: 0, kind: "highlight", color: "yellow", rects: [[72, 690, 300, 714]], quote: "", comment: "", body: null, groupUuid: null, createdAt: "t", updatedAt: "t", ...over,
});

describe("boxesOf and markAt", () => {
  const v = viewport(1);

  it("give a mark's lines, or a text note's box", () => {
    expect(boxesOf(mark(1, { rects: [[0, 0, 10, 10], [0, 20, 10, 30]] }), v)).toHaveLength(2);
    expect(boxesOf(mark(2, { kind: "text", rects: null, body: { rect: [100, 100, 200, 140], text: "x" } }), v)).toEqual([rawToBox([100, 100, 200, 140], v)]);
    expect(boxesOf(mark(3, { kind: "ink", rects: null, body: { strokes: [] } }), v)).toEqual([]);
  });

  it("finds the mark under a point, the newest when two lie there, and none outside", () => {
    const marks = [mark(1), mark(2)];
    const inside = { x: 100, y: 792 - 700 };

    expect(markAt(marks, inside.x, inside.y, v)?.id).toBe(2);
    expect(markAt([marks[0]], inside.x, inside.y, v)?.id).toBe(1);
    expect(markAt(marks, 5, 5, v)).toBeNull();
  });

  it("counts a couple of pixels past the edge, since a line of text is a narrow target", () => {
    const edge = { x: 72 - 1.5, y: 792 - 700 };

    expect(markAt([mark(1)], edge.x, edge.y, v)?.id).toBe(1);
    expect(markAt([mark(1)], 72 - 5, edge.y, v)).toBeNull();
  });
});

describe("paintFor", () => {
  it("is each of the five colors' own paint, and yellow for any other name", () => {
    expect(new Set(["yellow", "green", "blue", "pink", "orange"].map((c) => paintFor(c).fill)).size).toBe(5);
    expect(paintFor("chartreuse")).toEqual(paintFor("yellow"));
  });
});
