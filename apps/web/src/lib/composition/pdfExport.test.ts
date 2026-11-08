import fs from "node:fs";
import { createRequire } from "node:module";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import type { PdfAnnotation } from "./documentsApi";
import { embedNoteFonts, exportAnnotatedPdf, ExportRefused, layoutNote, missingCharacters } from "./pdfExport";

const require = createRequire(import.meta.url);
const fonts = {
  text: new Uint8Array(fs.readFileSync(require.resolve("@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf"))),
  math: new Uint8Array(fs.readFileSync(require.resolve("@expo-google-fonts/noto-sans-math/400Regular/NotoSansMath_400Regular.ttf"))),
};

type Geometry = { name: string; rotate?: number; media?: [number, number, number, number]; crop?: [number, number, number, number]; userUnit?: number };
// The test geometries of spike C: where a page's boxes do not start at 0,0, or it is turned, a rectangle in raw user space is still the same numbers.
const GEOMETRIES: Geometry[] = [
  { name: "plain" },
  { name: "rotate90", rotate: 90 },
  { name: "rotate180", rotate: 180 },
  { name: "rotate270", rotate: 270 },
  { name: "crop", crop: [30, 40, 500, 700] },
  { name: "media-offset", media: [-100, -50, 512, 742] },
  { name: "crop+rotate90", rotate: 90, crop: [30, 40, 500, 700] },
  { name: "media-offset+crop+rotate270", rotate: 270, media: [-100, -50, 512, 742], crop: [20, 30, 400, 600] },
  { name: "userunit2", userUnit: 2 },
];

async function pdfWith(geometry: Geometry, pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1} of the fixture`, { x: 100, y: 300, size: 24, font });
    if (geometry.media) page.setMediaBox(...geometry.media);
    if (geometry.crop) page.setCropBox(...geometry.crop);
    if (geometry.rotate) page.setRotation(degrees(geometry.rotate));
    if (geometry.userUnit) page.node.set(PDFName.of("UserUnit"), PDFNumber.of(geometry.userUnit));
  }
  return doc.save();
}

let nextId = 1;
const mark = (over: Partial<PdfAnnotation>): PdfAnnotation => ({
  id: nextId++,
  uuid: String(nextId).padStart(32, "a"),
  documentId: 1,
  page: 0,
  kind: "highlight",
  color: "yellow",
  rects: [[100, 296, 272, 322]],
  quote: "",
  comment: "",
  body: null,
  groupUuid: null,
  createdAt: "2026-11-07T10:00:00.000Z",
  updatedAt: "2026-11-07T11:30:15.000Z",
  ...over,
});
const note = (text: string, over: Partial<PdfAnnotation> = {}) => mark({ kind: "text", rects: null, color: "blue", body: { rect: [200, 100, 400, 160], text, fontSize: 12 }, ...over });

/** How many embedded fonts (Type0 composite fonts, which is what an embedded TrueType font becomes) a written PDF has. */
async function embeddedFonts(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof PDFDict && object.lookup(PDFName.of("Subtype"))?.toString() === "/Type0").length;
}

/** The annotations of a page of a written PDF, as the low-level dictionaries. */
async function annotationsOf(bytes: Uint8Array, pageIndex: number): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPages()[pageIndex].node.Annots();
  if (!annots) return [];
  return annots.asArray().map((entry) => doc.context.lookup(entry, PDFDict));
}
const numbers = (array: PDFArray | undefined) => array?.asArray().map((n) => (n as PDFNumber).asNumber());
const nameOf = (dict: PDFDict, key: string) => dict.lookup(PDFName.of(key))?.toString();

describe("exporting marks as native annotations", () => {
  it("writes each kind as its own annotation, with its rectangle, quad points, color, comment, id and an appearance", async () => {
    const original = await pdfWith({ name: "plain" });
    const marks = [
      mark({ kind: "highlight", rects: [[100, 296, 272, 322], [100, 270, 200, 296]], comment: "check this", uuid: "1".repeat(32) }),
      mark({ kind: "underline", color: "green", rects: [[100, 400, 272, 424]], uuid: "2".repeat(32) }),
      mark({ kind: "strikethrough", color: "pink", rects: [[100, 440, 272, 464]], uuid: "3".repeat(32) }),
      note("Spike note", { uuid: "4".repeat(32) }),
    ];

    const { bytes, written, skipped } = await exportAnnotatedPdf(original, marks, { flatten: false, fonts });

    expect(written).toBe(4);
    expect(skipped).toEqual({ ink: 0, offPage: 0 });
    const annots = await annotationsOf(bytes, 0);
    expect(annots.map((a) => nameOf(a, "Subtype"))).toEqual(["/Highlight", "/Underline", "/StrikeOut", "/FreeText"]);
    const [highlight, underline, strike, text] = annots;
    expect(numbers(highlight.lookup(PDFName.of("Rect"), PDFArray))).toEqual([100, 270, 272, 322]);
    expect(numbers(highlight.lookup(PDFName.of("QuadPoints"), PDFArray))).toEqual([100, 322, 272, 322, 100, 296, 272, 296, 100, 296, 200, 296, 100, 270, 200, 270]);
    expect(highlight.lookup(PDFName.of("Contents"))?.toString()).toContain("FEFF");
    expect(nameOf(highlight, "F")).toBe("4");
    expect(numbers(highlight.lookup(PDFName.of("C"), PDFArray))?.map((n) => Math.round(n * 255))).toEqual([255, 221, 51]);
    expect(highlight.lookup(PDFName.of("CA"), PDFNumber).asNumber()).toBe(0.5);
    expect(underline.has(PDFName.of("Contents"))).toBe(false);
    expect(numbers(underline.lookup(PDFName.of("C"), PDFArray))?.map((n) => Math.round(n * 255))).toEqual([0x2f, 0x9e, 0x44]);
    expect(numbers(strike.lookup(PDFName.of("Rect"), PDFArray))).toEqual([100, 440, 272, 464]);
    expect(numbers(text.lookup(PDFName.of("Rect"), PDFArray))).toEqual([200, 100, 400, 160]);
    for (const a of annots) {
      expect(a.lookup(PDFName.of("AP"), PDFDict).has(PDFName.of("N"))).toBe(true);
      expect(a.lookup(PDFName.of("NM"))?.toString()).toMatch(/^\(\d{32}\)$/);
      expect(a.lookup(PDFName.of("M"))?.toString()).toBe("(D:20261107113015Z)");
    }
  });

  it.each(GEOMETRIES)("keeps a rectangle's own numbers on a $name page, the way a PDF's own annotation does", async (geometry) => {
    const original = await pdfWith(geometry);
    const marks = [mark({ rects: [[100, 296, 272, 322]] }), mark({ page: 1, kind: "underline", rects: [[100, 400, 272, 424]] }), note("hello", { page: 1 })];

    const { bytes } = await exportAnnotatedPdf(original, marks, { flatten: false, fonts });

    const first = await annotationsOf(bytes, 0);
    const second = await annotationsOf(bytes, 1);
    expect(numbers(first[0].lookup(PDFName.of("Rect"), PDFArray))).toEqual([100, 296, 272, 322]);
    expect(numbers(second[0].lookup(PDFName.of("Rect"), PDFArray))).toEqual([100, 400, 272, 424]);
    expect(numbers(second[1].lookup(PDFName.of("Rect"), PDFArray))).toEqual([200, 100, 400, 160]);
  });

  it("is read back by pdf.js as native annotations, with their text", async () => {
    const original = await pdfWith({ name: "plain" });
    const marks = [mark({ kind: "highlight", comment: "why" }), mark({ kind: "underline", rects: [[100, 400, 272, 424]] }), mark({ kind: "strikethrough", rects: [[100, 440, 272, 464]] }), note("Café ≤ Привет")];

    const { bytes } = await exportAnnotatedPdf(original, marks, { flatten: false, fonts });

    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    const loaded = await task.promise;
    const found = await (await loaded.getPage(1)).getAnnotations();
    expect(found.map((a: { subtype: string }) => a.subtype)).toEqual(["Highlight", "Underline", "StrikeOut", "FreeText"]);
    expect(found.every((a: { hasAppearance: boolean }) => a.hasAppearance)).toBe(true);
    expect(found[0].contentsObj.str).toBe("why");
    expect(found[3].contentsObj.str).toBe("Café ≤ Привет");
    await task.destroy();
  });

  it("puts a text note upright on a rotated page: its appearance is turned back by the page's rotation", async () => {
    const original = await pdfWith({ name: "rotate90", rotate: 90 }, 1);

    const { bytes } = await exportAnnotatedPdf(original, [note("upright", { body: { rect: [200, 100, 400, 160], text: "upright" } })], { flatten: false, fonts });

    const [freeText] = await annotationsOf(bytes, 0);
    const doc = await PDFDocument.load(bytes);
    const appearance = doc.context.lookup(freeText.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N"))) as PDFRawStream;
    // The box is 200 wide and 60 tall in user space, so 60 by 200 as the page is shown, and turned 90 degrees back.
    expect(numbers(appearance.dict.lookup(PDFName.of("BBox"), PDFArray))).toEqual([0, 0, 60, 200]);
    expect(numbers(appearance.dict.lookup(PDFName.of("Matrix"), PDFArray))).toEqual([0, 1, -1, 0, 400, 100]);
  });

  it("leaves out an ink mark, which the iPad draws in a format that is not final, and a mark on a page the PDF does not have, and says so", async () => {
    const original = await pdfWith({ name: "plain" }, 1);
    const marks = [mark({}), mark({ kind: "ink", rects: null, body: { strokes: [] }, color: "black" }), mark({ page: 7 })];

    const { bytes, written, skipped } = await exportAnnotatedPdf(original, marks, { flatten: false, fonts });

    expect(written).toBe(1);
    expect(skipped).toEqual({ ink: 1, offPage: 1 });
    expect(await annotationsOf(bytes, 0)).toHaveLength(1);
  });

  it("keeps the annotations the PDF already had", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const link = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 10, 50, 50], Border: [0, 0, 0] } as never));
    page.node.addAnnot(link);

    const { bytes } = await exportAnnotatedPdf(await doc.save(), [mark({})], { flatten: false, fonts });

    expect((await annotationsOf(bytes, 0)).map((a) => nameOf(a, "Subtype"))).toEqual(["/Link", "/Highlight"]);
  });
});

describe("exporting marks flattened", () => {
  it("draws every mark into the page and adds no annotation", async () => {
    const original = await pdfWith({ name: "plain" }, 1);
    const marks = [mark({}), mark({ kind: "underline", rects: [[100, 400, 272, 424]] }), mark({ kind: "strikethrough", rects: [[100, 440, 272, 464]] }), note("burned in")];

    const { bytes, written } = await exportAnnotatedPdf(original, marks, { flatten: true, fonts });

    expect(written).toBe(4);
    expect(await annotationsOf(bytes, 0)).toEqual([]);
    const doc = await PDFDocument.load(bytes);
    const resources = doc.getPages()[0].node.Resources()!;
    const xobjects = resources.lookup(PDFName.of("XObject"), PDFDict);
    expect(xobjects.keys().filter((k) => k.toString().startsWith("/Export"))).toHaveLength(4);
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    expect(await (await (await task.promise).getPage(1)).getAnnotations()).toEqual([]);
    await task.destroy();
  });

  it.each(GEOMETRIES)("flattens on a $name page without error", async (geometry) => {
    const original = await pdfWith(geometry, 1);

    const { written } = await exportAnnotatedPdf(original, [mark({}), note("x")], { flatten: true, fonts });

    expect(written).toBe(2);
  });
});

describe("text notes", () => {
  it("are written with an embedded font, in any of the supported scripts", async () => {
    const original = await pdfWith({ name: "plain" }, 1);

    const { bytes } = await exportAnnotatedPdf(original, [note("Café ≤ Привет Ωμέγα √ ✓")], { flatten: false, fonts });

    // two fonts were needed: the text font, and the math font for ≤ √ and ✓
    expect(await embeddedFonts(bytes)).toBe(2);
    expect(bytes.length).toBeLessThan(original.length + 200_000);
  });

  it("do not embed the math font when no note needs it", async () => {
    const original = await pdfWith({ name: "plain" }, 1);

    const { bytes } = await exportAnnotatedPdf(original, [note("plain words")], { flatten: false, fonts });

    expect(await embeddedFonts(bytes)).toBe(1);
    expect(bytes.length).toBeLessThan(original.length + 80_000);
  });

  it("stop the export, naming the note, when a character cannot be drawn, and write nothing", async () => {
    const original = await pdfWith({ name: "plain" }, 3);
    const marks = [mark({}), note("日本語 and 😀", { page: 2 })];

    const refused = exportAnnotatedPdf(original, marks, { flatten: false, fonts });

    await expect(refused).rejects.toBeInstanceOf(ExportRefused);
    await expect(refused).rejects.toThrow(/page 3 \(.*日.*\)/);
    await expect(refused).rejects.toThrow(/Latin, Greek and Cyrillic/);
  });

  it("are counted when several cannot be drawn", async () => {
    const original = await pdfWith({ name: "plain" }, 6);
    const marks = [1, 2, 3, 4, 5].map((page) => note("日本", { page }));

    await expect(exportAnnotatedPdf(original, marks, { flatten: false, fonts })).rejects.toThrow(/5 text notes have characters.*and 2 more/);
  });

  it("find which characters are missing, once each, ignoring spaces and line breaks", () => {
    const covered = [new Set([97, 98, 99, 32])];

    expect(missingCharacters("ab c\nXYX\t日", covered)).toEqual(["X", "Y", "日"]);
  });
});

describe("layoutNote", () => {
  async function embedded() {
    const fonts_ = await embedNoteFonts(await PDFDocument.create(), fonts, true);
    return { text: fonts_.text, math: fonts_.math! };
  }

  it("breaks at spaces so that no line is wider than the box, and keeps the writer's own line breaks", async () => {
    const f = await embedded();

    const lines = layoutNote("one two three four five six\nnext paragraph", f, 12, 80);

    const texts = lines.map((l) => l.runs.map((r) => r.text).join(""));
    expect(texts.length).toBeGreaterThan(3);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(80 + 0.001);
    expect(texts.join(" ")).toBe("one two three four five six next paragraph");
    // the writer's line break stays a break: "six" ends a line even though "next" would have fitted after it
    expect(texts.findIndex((t) => t.endsWith("six"))).toBeLessThan(texts.findIndex((t) => t.startsWith("next")));
  });

  it("breaks a word that is wider than the line, and keeps an empty line between paragraphs", async () => {
    const f = await embedded();

    const lines = layoutNote("supercalifragilisticexpialidocious\n\nend", f, 12, 50);

    const texts = lines.map((l) => l.runs.map((r) => r.text).join(""));
    expect(texts.join("")).toBe("supercalifragilisticexpialidociousend");
    expect(texts).toContain("");
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(50 + 0.001);
  });

  it("puts a character the text font lacks in a run of the math font", async () => {
    const f = await embedded();

    const [line] = layoutNote("x ≤ y", f, 12, 400);

    expect(line.runs.map((r) => [r.text, r.font === f.math])).toEqual([["x ", false], ["≤", true], [" y", false]]);
  });
});

describe("what cannot be exported", () => {
  it("refuses a password-protected PDF, with a reason, rather than writing one that still says it is encrypted", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    await doc.encrypt({ userPassword: "secret", ownerPassword: "owner", permissions: {} });
    const protectedBytes = await doc.save();

    const refused = exportAnnotatedPdf(protectedBytes, [mark({})], { flatten: false, fonts });

    await expect(refused).rejects.toBeInstanceOf(ExportRefused);
    await expect(refused).rejects.toThrow(/password-protected/);
  });

  it("refuses a file that is not a PDF, with a reason", async () => {
    const refused = exportAnnotatedPdf(new TextEncoder().encode("not a pdf at all"), [mark({})], { flatten: false, fonts });

    await expect(refused).rejects.toBeInstanceOf(ExportRefused);
    await expect(refused).rejects.toThrow(/could not be read for export/);
  });
});

