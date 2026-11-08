import { describe, expect, it } from "vitest";
import { loadConformance } from "./__fixtures__/conformance";
import {
  InvalidMarkError,
  normalizeRect,
  normalizeViewState,
  parseViewState,
  validateAnnotation,
  validateBookmarkLabel,
  type PdfAnnotationInput,
} from "./pdfMarkup";

type Vectors = {
  annotations: ({ name: string; input: PdfAnnotationInput } & ({ stored: unknown; invalid?: never } | { invalid: true; stored?: never }))[];
  bookmarkLabels: ({ input: unknown } & ({ stored: string; invalid?: never } | { invalid: true; stored?: never }))[];
  viewStates: { input: unknown; stored: unknown }[];
};

/** The rules that the Swift core must follow too: the vectors are in fixtures/conformance/pdf/validation.json. */
const vectors = loadConformance<Vectors>("pdf/validation.json");

describe("validateAnnotation", () => {
  for (const vector of vectors.annotations) {
    it(vector.name, () => {
      if (vector.invalid) {
        expect(() => validateAnnotation(vector.input)).toThrow(InvalidMarkError);
      } else {
        expect(validateAnnotation(vector.input)).toEqual(vector.stored);
      }
    });
  }

  it("does not change what it was given", () => {
    const rects = [[100, 50, 10, 70]];
    const input: PdfAnnotationInput = { page: 0, kind: "highlight", color: "yellow", rects };
    validateAnnotation(input);
    expect(rects).toEqual([[100, 50, 10, 70]]);
  });
});

describe("validateBookmarkLabel", () => {
  for (const vector of vectors.bookmarkLabels) {
    it(`${vector.invalid ? "refuses" : "keeps"} ${JSON.stringify(vector.input).slice(0, 24)}`, () => {
      if (vector.invalid) expect(() => validateBookmarkLabel(vector.input)).toThrow(InvalidMarkError);
      else expect(validateBookmarkLabel(vector.input)).toBe(vector.stored);
    });
  }
});

describe("normalizeViewState", () => {
  for (const vector of vectors.viewStates) {
    it(`reads ${JSON.stringify(vector.input)}`, () => {
      expect(normalizeViewState(vector.input)).toEqual(vector.stored);
    });
  }

  it("reads the stored column, and a damaged one as nothing", () => {
    expect(parseViewState('{"page":3,"zoom":2}')).toEqual({ page: 3, zoom: 2 });
    expect(parseViewState("{not json")).toEqual({});
    expect(parseViewState(null)).toEqual({});
    expect(parseViewState("")).toEqual({});
  });
});

describe("normalizeRect", () => {
  it("puts the corners in order whichever two opposite ones it is given", () => {
    expect(normalizeRect([10, 20, 5, 2])).toEqual([5, 2, 10, 20]);
    expect(normalizeRect([5, 20, 10, 2])).toEqual([5, 2, 10, 20]);
  });
});
