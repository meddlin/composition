import {
  drawObject,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  type PDFFont,
  type PDFPage,
  type PDFRef,
} from "@cantoo/pdf-lib";
// @ts-expect-error fontkit ships no types. Of it the export uses `create`, to read which characters a font file holds, and the module
// itself, which the PDF library takes to read and subset the fonts it embeds.
import * as fontkit from "fontkit";
import type { PdfAnnotation } from "./documentsApi";
import { PDF_MARK_COLORS, type PdfMarkColor, type PdfRect, type PdfTextNoteBody } from "./pdfMarkup";

/**
 * Writes a copy of a PDF with its marks in it (docs/pdf-markup-plan.md, "Export annotated PDF"), with `@cantoo/pdf-lib`
 * (spike D). Two modes. Native: each mark is a standard annotation (Highlight, Underline, StrikeOut, FreeText) with a
 * hand-written appearance stream, so that other apps draw it and can still edit it. Flattened: the same appearances are
 * drawn into the page's own content, so every viewer shows the same and nothing can be edited. The file is never changed;
 * this builds new bytes from the old, in memory, and the caller writes them where the user chose.
 *
 * Every rectangle is in raw PDF user space, which is what a PDF's own annotations use, so nothing is converted except
 * where a text note must read upright on a rotated page. A text note is always drawn with an embedded font (a standard PDF
 * font holds WinAnsi only, and this library would write a `?` for anything else without saying so), and the export is
 * refused, naming the note, when a note has a character neither bundled font can draw.
 */

/** A reason the export did not happen, in words that are safe to show. */
export class ExportRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRefused";
  }
}

export type ExportOptions = {
  /** Draw the marks into the pages instead of adding annotations. */
  flatten: boolean;
  /** The bundled fonts for text notes: Noto Sans (Latin, Greek, Cyrillic), and Noto Sans Math for what it lacks. */
  fonts: { text: Uint8Array; math: Uint8Array };
  /**
   * The password the PDF opens with, when it needs one. It unlocks the file to write the marks into it, and the copy is then
   * protected with the same password and the same limits on printing and copying (see `protectCopy`). Used here and nowhere else:
   * it is never written to a file or into a message.
   */
  password?: string;
};

export type ExportResult = {
  bytes: Uint8Array;
  /** The copy is protected by the original's password (and its limits on printing and copying). */
  passwordProtected: boolean;
  /** How many marks were written. */
  written: number;
  /** Marks left out, and why, for the dialog to say. */
  skipped: { ink: number; offPage: number };
};

/** The colors of the marks as numbers, matching what the reader draws (`MARK_PAINT` in components/pdf/pdfGeometry.ts). */
const PAINT: Record<PdfMarkColor, { fill: [number, number, number]; alpha: number; line: [number, number, number] }> = {
  yellow: { fill: [255, 221, 51], alpha: 0.5, line: [0xd6, 0xa4, 0x00] },
  green: { fill: [92, 200, 100], alpha: 0.45, line: [0x2f, 0x9e, 0x44] },
  blue: { fill: [88, 166, 255], alpha: 0.45, line: [0x1c, 0x7e, 0xd6] },
  pink: { fill: [255, 128, 171], alpha: 0.5, line: [0xd6, 0x33, 0x6c] },
  orange: { fill: [255, 169, 77], alpha: 0.5, line: [0xe8, 0x59, 0x0c] },
};

/** A PDF object described as plain data, which the library turns into the real thing (its own `LiteralObject` is not exported, so its calls are cast). */
type Literal = Record<string, unknown>;

const unit = (rgb: readonly number[]) => rgb.map((n) => n / 255);
const paintFor = (color: string) => PAINT[(PDF_MARK_COLORS as readonly string[]).includes(color) ? (color as PdfMarkColor) : "yellow"];
const num = (n: number) => String(Math.round(n * 1000) / 1000);
const rgbOp = (rgb: readonly number[], stroke = false) => `${unit(rgb).map(num).join(" ")} ${stroke ? "RG" : "rg"}`;

/** A text note's size, in points, and the room around its words: the reader's own (`NOTE_FONT_SIZE`, a 3 px padding). */
const NOTE_FONT_SIZE = 12;
const NOTE_PADDING = 3;
const NOTE_LINE_HEIGHT = 1.25;
const NOTE_TEXT_COLOR = [0x11, 0x11, 0x11] as const;

// --- text layout ------------------------------------------------------------

type Run = { font: PDFFont; text: string; width: number };
type Line = { runs: Run[]; width: number };

/** The two fonts a note's characters come from: the text font first, and the math font for what it does not have. */
export type NoteFonts = { text: PDFFont; math: PDFFont | null };

/** Whether a character is one that draws nothing, which no font is asked for. */
const isBlank = (char: string) => /^[\s​-‍﻿]$/.test(char);

/** Characters of `text` that neither the text font nor the math font has a glyph for. */
export function missingCharacters(text: string, covered: readonly ReadonlySet<number>[]): string[] {
  const missing = new Set<string>();
  for (const char of text) {
    if (isBlank(char)) continue;
    const code = char.codePointAt(0)!;
    if (!covered.some((set) => set.has(code))) missing.add(char);
  }
  return [...missing];
}

/**
 * A note's words broken into lines no wider than `maxWidth` at `size`: at the newlines the writer typed, then at spaces,
 * and inside a word only when the word alone is wider than the line. Each line is runs of one font each.
 */
export function layoutNote(text: string, fonts: NoteFonts, size: number, maxWidth: number): Line[] {
  const textCovers = new Set(fonts.text.getCharacterSet());
  const fontFor = (char: string): PDFFont => (isBlank(char) || textCovers.has(char.codePointAt(0)!) || !fonts.math ? fonts.text : fonts.math);
  const widthOf = (piece: string) => {
    let width = 0;
    let run = "";
    let font: PDFFont | null = null;
    for (const char of piece) {
      const next = fontFor(char);
      if (font && next !== font) {
        width += font.widthOfTextAtSize(run, size);
        run = "";
      }
      font = next;
      run += char;
    }
    return font ? width + font.widthOfTextAtSize(run, size) : 0;
  };
  const toRuns = (piece: string): Run[] => {
    const runs: Run[] = [];
    for (const char of piece) {
      const font = fontFor(char);
      const last = runs[runs.length - 1];
      if (last && last.font === font) last.text += char;
      else runs.push({ font, text: char, width: 0 });
    }
    for (const run of runs) run.width = run.font.widthOfTextAtSize(run.text, size);
    return runs;
  };

  const lines: Line[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let current = "";
    const flush = () => {
      const runs = toRuns(current.replace(/\s+$/, ""));
      lines.push({ runs, width: runs.reduce((sum, run) => sum + run.width, 0) });
      current = "";
    };
    // Words keep the space after them, so a line break lands between words.
    for (const word of paragraph.match(/\S+\s*|\s+/g) ?? []) {
      if (current !== "" && widthOf((current + word).replace(/\s+$/, "")) > maxWidth) flush();
      if (widthOf(word.replace(/\s+$/, "")) <= maxWidth) {
        current += word;
        continue;
      }
      // A word wider than the whole line is broken wherever it fits.
      for (const char of word) {
        if (current !== "" && widthOf(current + char) > maxWidth) flush();
        current += char;
      }
    }
    flush();
  }
  return lines;
}

// --- appearance streams -----------------------------------------------------

/** The matrix that puts a text note's upright appearance into a page turned `rotation` degrees, its lower left at (x, y). */
function placement(rotation: number, x: number, y: number, dw: number, dh: number): [number, number, number, number, number, number] {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, x + dh, y];
    case 180:
      return [-1, 0, 0, -1, x + dw, y + dh];
    case 270:
      return [0, -1, 1, 0, x, y + dw];
    default:
      return [1, 0, 0, 1, x, y];
  }
}

/** A mark's rectangle on its page, or the box around all its lines. */
function bounds(rects: readonly PdfRect[]): PdfRect {
  return [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))];
}

/** QuadPoints for a rectangle in the order Acrobat and PDFKit read them: top left, top right, bottom left, bottom right. */
const quad = ([x0, y0, x1, y1]: PdfRect) => [x0, y1, x1, y1, x0, y0, x1, y0];

const pdfDate = (iso: string) => {
  const date = new Date(iso);
  const p = (n: number, width = 2) => String(n).padStart(width, "0");
  return Number.isNaN(date.getTime()) ? undefined : `D:${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
};

/** Writes `marks` into `doc`, returns how many were written. Fonts must already be embedded when a note needs them. */
function writeMarks(doc: PDFDocument, marks: readonly PdfAnnotation[], flatten: boolean, fonts: NoteFonts | null): { written: number; skipped: ExportResult["skipped"] } {
  const ctx = doc.context;
  const pages = doc.getPages();
  const skipped = { ink: 0, offPage: 0 };
  let written = 0;
  const multiply = (alpha: number) => ctx.obj({ Type: "ExtGState", BM: "Multiply", ca: alpha, CA: alpha } as never);
  const form = (bbox: number[], content: string, resources: Literal, matrix?: number[]) =>
    ctx.register(ctx.stream(content, { Type: "XObject", Subtype: "Form", FormType: 1, BBox: bbox, Resources: resources, ...(matrix ? { Matrix: matrix } : {}) } as never));

  /** The form for a text note on `page`, and the dictionary entries that describe it. */
  function noteForm(page: PDFPage, rect: PdfRect, body: PdfTextNoteBody, color: string): PDFRef {
    if (!fonts) throw new ExportRefused("A text note needs a font, and none was supplied.");
    const paint = paintFor(color);
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const [x0, y0, x1, y1] = rect;
    const dw = rotation % 180 === 0 ? x1 - x0 : y1 - y0;
    const dh = rotation % 180 === 0 ? y1 - y0 : x1 - x0;
    const size = body.fontSize ?? NOTE_FONT_SIZE;
    const lines = layoutNote(body.text, fonts, size, Math.max(1, dw - 2 * NOTE_PADDING));
    const names = new Map<PDFFont, string>();
    const fontResources: Record<string, PDFRef> = {};
    for (const font of [fonts.text, fonts.math]) {
      if (font && lines.some((line) => line.runs.some((run) => run.font === font))) {
        const name = `F${names.size}`;
        names.set(font, name);
        fontResources[name] = font.ref;
      }
    }
    // The box (a fill a little lighter than the reader's, which blends with the page), its border, and the words, clipped to it.
    const fill = paint.fill.map((c) => Math.round(c * 0.85 + 255 * 0.15));
    let content = `${rgbOp(fill)} ${rgbOp(paint.line, true)} 1 w 0.5 0.5 ${num(dw - 1)} ${num(dh - 1)} re B\n`;
    content += `q 0 0 ${num(dw)} ${num(dh)} re W n ${rgbOp(NOTE_TEXT_COLOR)} BT\n`;
    lines.forEach((line, index) => {
      const baseline = dh - NOTE_PADDING - size * 0.95 - index * size * NOTE_LINE_HEIGHT;
      let x = NOTE_PADDING;
      for (const run of line.runs) {
        const encoded = run.font.encodeText(run.text);
        content += `/${names.get(run.font)} ${num(size)} Tf 1 0 0 1 ${num(x)} ${num(baseline)} Tm ${encoded.toString()} Tj\n`;
        x += run.width;
      }
    });
    content += "ET Q";
    return form([0, 0, dw, dh], content, { Font: fontResources }, placement(rotation, x0, y0, dw, dh));
  }

  for (const mark of marks) {
    const page = pages[mark.page];
    if (!page) {
      skipped.offPage++;
      continue;
    }
    if (mark.kind === "ink") {
      // Ink is drawn on the iPad, and its stroke format is not final yet, so there is nothing to write for it here.
      skipped.ink++;
      continue;
    }

    const paint = paintFor(mark.color);
    const comment = mark.comment === "" ? {} : { Contents: PDFHexString.fromText(mark.comment) };
    const common = { Type: "Annot", F: 4, NM: PDFString.of(mark.uuid), ...comment, ...(pdfDate(mark.updatedAt) ? { M: PDFString.of(pdfDate(mark.updatedAt)!) } : {}) };
    let appearance: PDFRef;
    let annotation: Literal;

    if (mark.kind === "text") {
      const body = mark.body as PdfTextNoteBody;
      appearance = noteForm(page, body.rect as PdfRect, body, mark.color);
      annotation = {
        ...common,
        Subtype: "FreeText",
        Rect: body.rect,
        Contents: PDFHexString.fromText(body.text),
        DA: PDFString.of(`/Helv ${num(body.fontSize ?? NOTE_FONT_SIZE)} Tf ${rgbOp(NOTE_TEXT_COLOR)}`),
        IC: unit(paint.fill.map((c) => Math.round(c * 0.85 + 255 * 0.15))),
        C: unit(paint.line),
        BS: { W: 1 },
      };
    } else {
      const rects = mark.rects as PdfRect[];
      const box = bounds(rects);
      let content = "";
      let resources: Literal = {};
      let subtype: string;
      if (mark.kind === "highlight") {
        subtype = "Highlight";
        resources = { ExtGState: { GS: multiply(paint.alpha) } };
        content = `/GS gs ${rgbOp(paint.fill)}\n${rects.map(([x0, y0, x1, y1]) => `${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)} re f`).join("\n")}`;
      } else {
        subtype = mark.kind === "underline" ? "Underline" : "StrikeOut";
        content = `${rgbOp(paint.line, true)}\n${rects
          .map(([x0, y0, x1, y1]) => {
            const thickness = Math.max(0.75, (y1 - y0) * 0.09);
            const y = mark.kind === "underline" ? y0 + thickness / 2 : (y0 + y1) / 2;
            return `${num(thickness)} w ${num(x0)} ${num(y)} m ${num(x1)} ${num(y)} l S`;
          })
          .join("\n")}`;
      }
      appearance = form(box, content, resources);
      annotation = {
        ...common,
        Subtype: subtype,
        Rect: box,
        QuadPoints: rects.flatMap(quad),
        C: unit(mark.kind === "highlight" ? paint.fill : paint.line),
        CA: mark.kind === "highlight" ? paint.alpha : 1,
        Border: [0, 0, 0],
      };
    }

    if (flatten) {
      // Drawn into the page's own content: the form carries its own matrix, so invoking it puts it in place.
      const name = page.node.newXObject("Export", appearance);
      page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState());
    } else {
      page.node.addAnnot(ctx.register(ctx.obj({ ...annotation, AP: { N: appearance } } as never)));
    }
    written++;
  }
  return { written, skipped };
}

// --- the export -------------------------------------------------------------

/** The code points a font file has a glyph for. */
function coverageOf(bytes: Uint8Array): Set<number> {
  const font = (fontkit as unknown as { create(data: Uint8Array): { characterSet: number[] } }).create(bytes);
  return new Set(font.characterSet);
}

/** Sentences for a note that cannot be written, one per note, so the person can find and change it. */
function describeUnwritable(notes: { page: number; text: string; characters: string[] }[]): string {
  const shown = notes.slice(0, 3).map((n) => `page ${n.page + 1} (${n.characters.slice(0, 6).join(" ")})`);
  const more = notes.length > 3 ? ` and ${notes.length - 3} more` : "";
  return `${notes.length === 1 ? "A text note has" : `${notes.length} text notes have`} characters that cannot be written into an exported PDF: ${shown.join(", ")}${more}. The export supports Latin, Greek and Cyrillic letters and common math symbols. Change ${notes.length === 1 ? "that note" : "those notes"} or leave ${notes.length === 1 ? "it" : "them"} out, then export again.`;
}

/** Puts the text font into `doc`, and the math font when a note needs it; each is cut down to the glyphs used when the PDF is saved. */
export async function embedNoteFonts(doc: PDFDocument, fonts: ExportOptions["fonts"], withMath: boolean): Promise<NoteFonts> {
  doc.registerFontkit(fontkit as never);
  const text = await doc.embedFont(fonts.text, { subset: true });
  return { text, math: withMath ? await doc.embedFont(fonts.math, { subset: true }) : null };
}

/**
 * The PDF `bytes` with `marks` written into it. A PDF that needs a password is opened with `options.password`, and the copy is
 * protected with the same password and limits. Throws `ExportRefused` when the PDF needs a password that was not given or is
 * wrong, or cannot be read, or when a text note has a character no bundled font can draw (nothing is written then, so nothing
 * is lost silently).
 */
export async function exportAnnotatedPdf(bytes: Uint8Array, marks: readonly PdfAnnotation[], options: ExportOptions): Promise<ExportResult> {
  // The notes first: a note that cannot be written stops the export before the file is read at all.
  const notes = marks.filter((m) => m.kind === "text");
  const covered = [coverageOf(options.fonts.text), coverageOf(options.fonts.math)] as const;
  const unwritable = notes
    .map((m) => ({ page: m.page, text: (m.body as PdfTextNoteBody).text, characters: missingCharacters((m.body as PdfTextNoteBody).text, covered) }))
    .filter((n) => n.characters.length > 0);
  if (unwritable.length > 0) throw new ExportRefused(describeUnwritable(unwritable));

  let doc: PDFDocument;
  try {
    // An empty password opens a PDF that is only restricted (printing or copying limited, but no password to open it), as it
    // does in the reader; one that needs a password says so, or says the one given is wrong.
    doc = await PDFDocument.load(bytes, { updateMetadata: false, password: options.password ?? "" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (/needs password|is encrypted/i.test(reason)) {
      throw new ExportRefused("This PDF is protected by a password. Open it in the reader and enter the password, then export again.");
    }
    if (/password incorrect/i.test(reason)) throw new ExportRefused("The password does not open this PDF, so it cannot be exported.");
    throw new ExportRefused(`This PDF could not be read for export: ${reason || "it may be damaged"}.`);
  }
  // Read before anything is written: what the original's protection was, for the copy to have the same.
  const protection = originalProtection(doc);

  const needsMath = notes.some((m) => missingCharacters((m.body as PdfTextNoteBody).text, [covered[0]]).length > 0);
  const fonts = notes.length > 0 ? await embedNoteFonts(doc, options.fonts, needsMath) : null;
  const { written, skipped } = writeMarks(doc, marks, options.flatten, fonts);
  if (protection) protectCopy(doc, protection, options.password ?? "");
  return { bytes: await doc.save(), passwordProtected: protection !== null && options.password !== undefined, written, skipped };
}

/** What the original's protection allowed, as the PDF library takes it for a new document. */
type Protection = NonNullable<Parameters<PDFDocument["encrypt"]>[0]["permissions"]>;

/**
 * The protection the original had, or null for a PDF that had none. The library decrypts a file it was given the password of and
 * leaves its encryption dictionary behind as an unused object, which is where the permission flags (`/P`) are read from. A test
 * pins that, since it is behaviour of the library rather than something it documents.
 */
function originalProtection(doc: PDFDocument): Protection | null {
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || object.get(PDFName.of("Filter"))?.toString() !== "/Standard") continue;
    const flags = object.get(PDFName.of("P"));
    if (!(flags instanceof PDFNumber)) continue;
    const p = flags.asNumber();
    const has = (bit: number) => (p & (1 << (bit - 1))) !== 0;
    return {
      printing: has(12) ? "highResolution" : has(3) ? "lowResolution" : false,
      modifying: has(4),
      copying: has(5),
      annotating: has(6),
      fillingForms: has(9),
      contentAccessibility: has(10),
      documentAssembly: has(11),
    };
  }
  return null;
}

/**
 * Protects the copy the way the original was: the password it opens with, and the same limits on printing and copying. The
 * password that opens a copy is the one given; the one that lifts its limits is made up here and kept by no one, as for a
 * PDF whose owner password is not shared. AES-256, whatever the original used.
 */
function protectCopy(doc: PDFDocument, permissions: Protection, password: string): void {
  doc.encrypt({ userPassword: password, ownerPassword: globalThis.crypto.randomUUID(), permissions, algorithm: "AES-256" });
}
