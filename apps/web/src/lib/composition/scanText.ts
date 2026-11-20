import { normalizeRect, type PdfRect } from "./pdfMarkup";

/**
 * The rules for text read from scanned pages (docs/scanned-notes-ocr-research.md; docs/architecture/scans.md): which
 * lines are kept, which are held back from everything until a person has looked, which reach search, and what a page's
 * text is. The Swift core (`ScanText.swift`) replays fixtures/conformance/scan against the same rules.
 *
 * **Confidence is not the safety.** On the owner's iPad, Vision read a cursive signature as a swear word and was sure of
 * it (confidence 1.00, Gate C item 263), because language correction had snapped the marks to a common word. So a line is
 * held when its confidence is under the floor *or* it holds a word from a short list a program never writes on a guess.
 * The iPad's `InkTranscript` applies the same guard to a drawing's `alt`.
 */

/** Whether a person has looked at a line. Only `checked` and `corrected` were seen by a person. */
export type ScanLineStatus = "unchecked" | "held" | "checked" | "corrected";

export const SCAN_LINE_STATUSES: readonly ScanLineStatus[] = ["unchecked", "held", "checked", "corrected"];

/** The least confidence (0 to 1) a line needs to be used before a person has checked it: `InkTranscript.minimumConfidence`. */
export const RECOGNIZED_TEXT_FLOOR = 0.5;

/** Why a recognised line or a correction was refused. The message is safe to show. */
export class InvalidScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScanError";
  }
}

/** A line as an engine read it, before it is checked and stored. */
export type RecognizedLineInput = { rect: readonly number[]; text: string; confidence: number };

/** A line as it is stored: its box rounded as marks' are, its text on one line, its confidence rounded to a thousandth. */
export type ValidRecognizedLine = { rect: PdfRect; text: string; confidence: number; status: "unchecked" | "held" };

/** Roots blocked anywhere in a word ("motherfucker"): no word or name holds them innocently. */
const NEVER_GUESSED_ANYWHERE = ["fuck"];
/** Roots blocked at the start or the end of a word ("shitty", "bullshit") but not in the middle, where names hold them ("Matsushita"). */
const NEVER_GUESSED_AT_EITHER_END = ["shit"];
/** Words blocked only whole ("Scunthorpe" holds the first, and is fine). Short on purpose, and meant to be added to. */
const NEVER_GUESSED_WORDS = new Set([
  "cunt",
  "cunts",
  "bitch",
  "bitches",
  "asshole",
  "assholes",
  "nigger",
  "niggers",
  "nigga",
  "niggas",
  "faggot",
  "faggots",
]);

/** Case and accents folded away, as Swift's `folding(options: [.caseInsensitive, .diacriticInsensitive])` does for these words. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Whether `line` holds a word that is never written from a guess. Words are compared whole, with case, accents and
 * punctuation ignored; only the roots also match as part of a longer word.
 */
export function neverGuessed(line: string): boolean {
  return fold(line)
    .split(/\P{L}+/u)
    .filter((word) => word.length > 0)
    .some(
      (word) =>
        NEVER_GUESSED_WORDS.has(word) ||
        NEVER_GUESSED_ANYWHERE.some((root) => word.includes(root)) ||
        NEVER_GUESSED_AT_EITHER_END.some((root) => word.startsWith(root) || word.endsWith(root)),
    );
}

/** A recognised line's status when it is stored: held when the engine was unsure or the line holds a never-guessed word. */
export function recognizedStatus(text: string, confidence: number): "unchecked" | "held" {
  return confidence < RECOGNIZED_TEXT_FLOOR || neverGuessed(text) ? "held" : "unchecked";
}

/** Runs of white space (line breaks included) as one space, and none at the ends. */
export function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Checks a recognised line and returns it as it is stored, or null when it has no text (an engine can return a box with
 * nothing in it, and such a line is not kept). Throws `InvalidScanError` for a box that is not four finite numbers with an
 * area, a text that is not text, or a confidence that is not a number; a confidence outside 0 to 1 is brought inside.
 */
export function validateRecognizedLine(input: RecognizedLineInput): ValidRecognizedLine | null {
  if (typeof input.text !== "string") throw new InvalidScanError("A line's text is text.");
  if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence)) throw new InvalidScanError("A line's confidence is a number.");
  let rect: PdfRect;
  try {
    rect = normalizeRect(input.rect, "line's box");
  } catch (error) {
    throw new InvalidScanError(error instanceof Error ? error.message : "A line's box is four numbers.");
  }
  const text = oneLine(input.text);
  if (text === "") return null;
  const confidence = round3(Math.min(1, Math.max(0, input.confidence)));
  return { rect, text, confidence, status: recognizedStatus(text, confidence) };
}

/** What a line holds that matters to search and to its page's text. */
export type ScanLineText = { line: number; text: string; status: ScanLineStatus; corrected: string | null };

/**
 * The text of a line that search may use, or null for none: a correction as the person wrote it, a checked line as it
 * was read, an unchecked line as it was read (it passed the guard; decision 4 of the research, my pick until the owner
 * says otherwise), and never a held line.
 */
export function lineSearchText(line: Pick<ScanLineText, "text" | "status" | "corrected">): string | null {
  switch (line.status) {
    case "corrected":
      return line.corrected ?? "";
    case "checked":
    case "unchecked":
      return line.text;
    default:
      return null;
  }
}

/**
 * A scanned page's text for search: its lines in reading order (`line`, then the order given), each line's search text,
 * the empty ones left out, one per line. The indexer then treats it as it treats a PDF page's own text (`pageSearchText`).
 */
export function scanPageText(lines: readonly ScanLineText[]): string {
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => a.line.line - b.line.line || a.index - b.index)
    .map(({ line }) => lineSearchText(line))
    .filter((text): text is string => text !== null && text !== "")
    .join("\n");
}

/** How much of `rect`'s area `other` covers, 0 to 1. */
export function coveredShare(rect: PdfRect, other: PdfRect): number {
  const width = Math.min(rect[2], other[2]) - Math.max(rect[0], other[0]);
  const height = Math.min(rect[3], other[3]) - Math.max(rect[1], other[1]);
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / ((rect[2] - rect[0]) * (rect[3] - rect[1]));
}

/**
 * Whether a newly read line is left out because a line a person has looked at is already there: more than half of the
 * new line's box is under a checked or corrected line's. Reading a page again never touches what a person has seen.
 */
export function coveredByKept(rect: PdfRect, kept: readonly PdfRect[]): boolean {
  return kept.some((other) => coveredShare(rect, other) > 0.5);
}
