// Spike D: the marks every adapter writes, in raw PDF user space (spike C's convention), on every page of geometry.pdf.
// Each kind has its own colour so a render can find it: highlight yellow, underline green, strikeout blue, text note orange (the
// text itself, no fill), ink magenta (the fixture's own landmark is a red square at (100,100)-(150,150) and black text with its
// baseline at (100,300)).
// All of them sit inside the part of the page that every test geometry shows: x 50..420, y 60..560.
export const COLORS = {
  highlight: [1, 1, 0],
  underline: [0, 0.8, 0],
  strikeout: [0, 0, 1],
  text: [1, 0.5, 0],
  ink: [1, 0, 1],
};

export const MARKS = [
  { kind: "highlight", rect: [100, 296, 272, 322] },
  { kind: "underline", rect: [100, 400, 272, 424] },
  { kind: "strikeout", rect: [100, 440, 272, 464] },
  { kind: "text", rect: [200, 100, 400, 160], contents: "Spike note" },
  { kind: "ink", rect: [100, 500, 300, 540], width: 3, points: [[100, 520], [150, 540], [200, 500], [250, 540], [300, 520]] },
];

/** QuadPoints for a rectangle, in the order Acrobat and PDFKit expect: top-left, top-right, bottom-left, bottom-right. */
export function quad([x0, y0, x1, y1]) {
  return [x0, y1, x1, y1, x0, y0, x1, y0];
}

/** The colour classifier used on renders: does this pixel belong to this kind? */
export function isKind(kind, r, g, b) {
  switch (kind) {
    case "highlight": return r > 200 && g > 200 && b < 120;
    case "underline": return g > 150 && r < 100 && b < 100;
    case "strikeout": return b > 200 && r < 80 && g < 80;
    case "text": return r > 200 && g > 90 && g < 190 && b < 90;
    case "ink": return r > 200 && g < 80 && b > 200;
    default: return false;
  }
}

/** Pages to mark (0-based): every page, or the comma list in MARK_PAGES (for a big file, where marking all 600 pages is not realistic). */
export const markedPages = (count) => (process.env.MARK_PAGES ? process.env.MARK_PAGES.split(",").map(Number).filter((i) => i < count) : [...Array(count).keys()]);
