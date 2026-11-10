import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conformancePath } from "./__fixtures__/conformance";
import { discardStagedBackup, stageBackup, type StagedBackup } from "./backup";
import { imageNameFromRef } from "./imageRefs";
import { readImage } from "./images";
import { parseInkText } from "./ink";
import { pixelsPerPoint, readInkPng } from "./inkPng";
import { CSS_INK_PALETTE, inkColor, inkPicture } from "./inkSvg";

/**
 * A backup made by the iPad's Swift code with a drawing in it (fixtures/conformance/ink/backup.tar.gz, written by InkBackupTests), restored by the desktop's own
 * `stageBackup`: the note has its `<Ink>` tag, the PNG is in `app_data/`, the desktop serves it as an image, and its strokes read and draw. This is Gate C's
 * "a backup restored on the desktop" without the iPad: what is left for the iPad is that its own drawings, made with the Pencil, do the same.
 */

const backup = fileURLToPath(conformancePath("ink/backup.tar.gz"));
const drawingText = fs.readFileSync(conformancePath("ink/drawing.json"), "utf8");

let dataDir: string;
let staged: StagedBackup;

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-ink-backup-"));
  staged = await stageBackup(backup, dataDir);
});

afterEach(async () => {
  await discardStagedBackup(staged);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** The note the backup holds, and the stored name its `<Ink>` tag shows. */
function theNote() {
  const db = new Database(path.join(staged.dir, "composition.db"), { readonly: true, fileMustExist: true });
  try {
    const notes = db.prepare("SELECT title, content FROM notes").all() as { title: string; content: string }[];
    expect(notes).toHaveLength(1);
    const tag = notes[0].content.match(/<Ink\b[^<>]*\/>/)?.[0];
    const src = tag?.match(/\bsrc="([^"]+)"/)?.[1];
    return { ...notes[0], tag, name: src ? imageNameFromRef(src) : null };
  } finally {
    db.close();
  }
}

describe("a backup the iPad made, with a drawing in it, restored by the desktop", () => {
  it("restores the note with its tag and the drawing's PNG among the images", () => {
    expect(staged.counts).toMatchObject({ notes: 1, images: 1 });
    expect(staged.hasImages).toBe(true);
    const note = theNote();
    expect(note.title).toBe("Trip plan");
    expect(note.content).toContain("A sketch from the iPad:");
    expect(note.tag).toMatch(/^<Ink src="app_data\/trip-plan-drawing-[0-9a-f]{12}\.png" alt="[^"]*" \/>$/);
    expect(note.name).toMatch(/^trip-plan-drawing-[0-9a-f]{12}\.png$/);
    expect(fs.existsSync(path.join(staged.dir, "app_data", note.name!))).toBe(true);
  });

  it("serves the PNG as an image, the private chunks and all", async () => {
    // Applied as a restore does: the staged images become the data directory's.
    fs.renameSync(path.join(staged.dir, "app_data"), path.join(dataDir, "app_data"));
    const image = await readImage(dataDir, theNote().name!);
    expect(image?.contentType).toBe("image/png");
    expect(image?.data.subarray(1, 4).toString("latin1")).toBe("PNG");
  });

  it("reads the strokes the iPad wrote, and they are the corpus's drawing", async () => {
    const png = new Uint8Array(fs.readFileSync(path.join(staged.dir, "app_data", theNote().name!)));
    const { drawing, problems } = await readInkPng(png);
    expect(problems).toEqual([]);
    expect(drawing).toEqual(parseInkText(drawingText));
    expect(pixelsPerPoint(png)).toBe(2);
  });

  it("draws them: a shape to a stroke, each in the colour its name has on every scheme", async () => {
    const png = new Uint8Array(fs.readFileSync(path.join(staged.dir, "app_data", theNote().name!)));
    const drawing = (await readInkPng(png)).drawing!;
    const { width, height, shapes } = inkPicture(drawing);
    expect([width, height]).toEqual([200, 120]);
    // Ink and accent are the scheme's own variables, so the dark, light, cream, forest and wine schemes each give them their colours; the marker's hue is the
    // same on all five; the fixed red is as stored on a light scheme and as PencilKit would show it on a dark one (`color-scheme` chooses).
    expect(shapes.map((shape) => shape.fill)).toEqual(["var(--foreground)", "#f5c518", inkColor("#c81e1e", CSS_INK_PALETTE), "var(--brand)"]);
    expect(shapes[2].fill).toMatch(/^light-dark\(#c81e1e, #[0-9a-f]{6}\)$/);
  });
});
