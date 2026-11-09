/**
 * What a mark on a PDF is, and what makes one valid (docs/pdf-markup-plan.md). Types and pure functions only, so it is
 * safe to import anywhere (renderer, main process, tests); the Swift core implements the same rules, pinned by the
 * conformance fixtures in `fixtures/conformance/pdf/`.
 *
 * Every rectangle is in raw PDF user space: the numbers a PDF's own annotation `/Rect` and `/QuadPoints` use, in points,
 * unrotated, whatever the page's crop box, media box or rotation (spike C). They are stored rounded to a thousandth of a
 * point so that the two implementations print the same digits.
 */

export const PDF_MARK_KINDS = ["highlight", "underline", "strikethrough", "text", "ink"] as const;
export type PdfMarkKind = (typeof PDF_MARK_KINDS)[number];

/** The kinds that mark lines of text: they carry rectangles, one per line, and a quote. */
export const PDF_TEXT_MARK_KINDS = ["highlight", "underline", "strikethrough"] as const;

/** The five `<Mark>` colors a text mark can have (docs/ui/text-highlighting.md): names, never hex values. */
export const PDF_MARK_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
export type PdfMarkColor = (typeof PDF_MARK_COLORS)[number];

/** x0, y0, x1, y1 with x0 < x1 and y0 < y1. */
export type PdfRect = [x0: number, y0: number, x1: number, y1: number];

/** A typed text note: its box and its text. */
export type PdfTextNoteBody = { rect: PdfRect; text: string; fontSize?: number };

/** What a caller says about a new mark. */
export type PdfAnnotationInput = {
  /** 0-based page index. */
  page: number;
  kind: PdfMarkKind;
  color: string;
  /** Text marks: the marked lines. Not allowed on a text note or ink. */
  rects?: readonly (readonly number[])[] | null;
  quote?: string;
  /** One line. */
  comment?: string;
  /** A text note: `PdfTextNoteBody`. Ink: the page's strokes (the stroke format is not frozen yet). Not allowed on text marks. */
  body?: unknown;
  /** Ties the per-page records of one selection that crossed pages together. */
  groupUuid?: string | null;
};

/** What a caller may change of a mark already made; its page, kind and group never change. */
export type AnnotationChanges = Partial<Pick<PdfAnnotationInput, "color" | "comment" | "quote" | "rects" | "body">>;

/** A mark as it is stored: every field present and normalised. */
export type ValidAnnotation = {
  page: number;
  kind: PdfMarkKind;
  color: string;
  rects: PdfRect[] | null;
  quote: string;
  comment: string;
  body: unknown;
  groupUuid: string | null;
};

/** A mark or bookmark that breaks the rules; the message is safe to show. */
export class InvalidMarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMarkError";
  }
}

export const MAX_COMMENT_LENGTH = 500;
export const MAX_BOOKMARK_LABEL_LENGTH = 200;
/** Far past any real page (a PDF's own limit is 14,400 units), near enough to catch garbage. */
const COORDINATE_LIMIT = 1e7;
const COLOR_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const UUID = /^[0-9a-f]{32}$/;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** A rectangle from any two opposite corners, put in order and rounded; throws when it is not a real, non-empty one. */
export function normalizeRect(value: unknown, what = "rectangle"): PdfRect {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= COORDINATE_LIMIT)) {
    throw new InvalidMarkError(`A ${what} is four finite numbers: x0, y0, x1, y1.`);
  }
  const [a, b, c, d] = value as number[];
  const rect: PdfRect = [round3(Math.min(a, c)), round3(Math.min(b, d)), round3(Math.max(a, c)), round3(Math.max(b, d))];
  if (rect[2] <= rect[0] || rect[3] <= rect[1]) throw new InvalidMarkError(`A ${what} must have an area.`);
  return rect;
}

function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** Checks a mark and returns it as it is stored. Throws `InvalidMarkError`; the message is safe to show. */
export function validateAnnotation(input: PdfAnnotationInput): ValidAnnotation {
  if (!Number.isInteger(input.page) || input.page < 0) throw new InvalidMarkError("A page is a whole number from 0.");
  if (!(PDF_MARK_KINDS as readonly string[]).includes(input.kind)) throw new InvalidMarkError(`Unknown kind of mark: ${String(input.kind)}.`);
  const isTextMark = (PDF_TEXT_MARK_KINDS as readonly string[]).includes(input.kind);

  if (typeof input.color !== "string") throw new InvalidMarkError("A mark needs a color.");
  if (isTextMark ? !(PDF_MARK_COLORS as readonly string[]).includes(input.color) : !COLOR_NAME.test(input.color)) {
    throw new InvalidMarkError(isTextMark ? `A ${input.kind} is ${PDF_MARK_COLORS.join(", ")}.` : "A color is a lowercase name.");
  }

  if ((input.quote !== undefined && typeof input.quote !== "string") || (input.comment !== undefined && typeof input.comment !== "string")) {
    throw new InvalidMarkError("A quote and a comment are text.");
  }
  const quote = input.quote ?? "";
  const comment = oneLine(input.comment ?? "");
  if (comment.length > MAX_COMMENT_LENGTH) throw new InvalidMarkError(`A comment can be at most ${MAX_COMMENT_LENGTH} characters.`);

  const groupUuid = input.groupUuid ?? null;
  if (groupUuid !== null && (typeof groupUuid !== "string" || !UUID.test(groupUuid))) {
    throw new InvalidMarkError("A group is a 32-character lowercase hex uuid.");
  }

  const hasRects = input.rects !== undefined && input.rects !== null;
  const hasBody = input.body !== undefined && input.body !== null;

  if (isTextMark) {
    if (hasBody) throw new InvalidMarkError(`A ${input.kind} has rectangles, not a body.`);
    if (!Array.isArray(input.rects) || input.rects.length === 0) throw new InvalidMarkError(`A ${input.kind} needs at least one rectangle.`);
    const rects = input.rects.map((r) => normalizeRect(r));
    return { page: input.page, kind: input.kind, color: input.color, rects, quote, comment, body: null, groupUuid };
  }

  if (hasRects) throw new InvalidMarkError(`A ${input.kind} has a body, not rectangles.`);
  if (quote !== "") throw new InvalidMarkError(`A ${input.kind} has no quote.`);
  if (groupUuid !== null) throw new InvalidMarkError(`A ${input.kind} is not part of a selection that crossed pages.`);

  if (input.kind === "text") {
    const body = input.body as Partial<PdfTextNoteBody> | null | undefined;
    if (!body || typeof body !== "object" || typeof body.text !== "string") throw new InvalidMarkError("A text note's body is its rect and its text.");
    const fontSize = body.fontSize;
    if (fontSize !== undefined && !(typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize >= 1 && fontSize <= 200)) {
      throw new InvalidMarkError("A text note's font size is from 1 to 200.");
    }
    const normalized: PdfTextNoteBody = { rect: normalizeRect(body.rect, "text note box"), text: body.text };
    if (fontSize !== undefined) normalized.fontSize = round3(fontSize);
    return { page: input.page, kind: "text", color: input.color, rects: null, quote, comment, body: normalized, groupUuid };
  }

  // ink: the stroke format is not frozen yet (the iPad design's D9), so any JSON object or array will do
  if (!hasBody || typeof input.body !== "object") throw new InvalidMarkError("Ink needs its strokes as the body.");
  return { page: input.page, kind: "ink", color: input.color, rects: null, quote, comment, body: input.body, groupUuid };
}

/** A bookmark's label: one line, at most `MAX_BOOKMARK_LABEL_LENGTH` characters, possibly empty (the page number is shown then). */
export function validateBookmarkLabel(label: unknown): string {
  if (typeof label !== "string") throw new InvalidMarkError("A bookmark's label is text.");
  const text = oneLine(label);
  if (text.length > MAX_BOOKMARK_LABEL_LENGTH) throw new InvalidMarkError(`A bookmark's label can be at most ${MAX_BOOKMARK_LABEL_LENGTH} characters.`);
  return text;
}

/** Where the reader was in a PDF, remembered per device (not a bookmark). */
export type PdfViewState = { page?: number; zoom?: number; darkPages?: boolean };

/** Keeps the three known keys, when they are sane, and drops the rest. */
export function normalizeViewState(value: unknown): PdfViewState {
  const state: PdfViewState = {};
  if (typeof value !== "object" || value === null) return state;
  const { page, zoom, darkPages } = value as Record<string, unknown>;
  if (typeof page === "number" && Number.isInteger(page) && page >= 0) state.page = page;
  if (typeof zoom === "number" && Number.isFinite(zoom) && zoom >= 0.1 && zoom <= 10) state.zoom = round3(zoom);
  if (typeof darkPages === "boolean") state.darkPages = darkPages;
  return state;
}

/** The stored `view_state` column to a state; a missing or damaged one is an empty state. */
export function parseViewState(json: string | null): PdfViewState {
  if (!json) return {};
  try {
    return normalizeViewState(JSON.parse(json));
  } catch {
    return {};
  }
}
