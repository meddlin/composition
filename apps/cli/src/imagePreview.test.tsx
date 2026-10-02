import fs from "node:fs";
import path from "node:path";
import { NativeImage } from "@opentui/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IMAGE_DIR_NAME, loadWebSettings, service } from "./backend";
import { clearImageCache } from "./images";
import { makePng } from "./testImages";
import { backgroundAt, createSandbox, frame, press, settle, type Rendered, type Sandbox } from "./testing";

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox();
  clearImageCache();
});
afterEach(async () => {
  await sandbox.dispose();
  clearImageCache();
});

// How a cell shows its 2x2 pixels in two colors: a block, or a quadrant mix of them.
const PICTURE_CELL = /[▀▄█▌▐▘▝▖▗▚▞▛▜▙▟]/u;
const PICTURE_CELLS = /[▀▄█▌▐▘▝▖▗▚▞▛▜▙▟]/gu;
const SCREEN = { width: 140, height: 50 };

/** Stores `png` the way a paste does, and returns the Markdown path a note uses for it. */
async function store(noteId: number, png: Uint8Array, fileName = "picture.png"): Promise<string> {
  const { name, error } = await service.saveImage({ noteId, fileName, data: png });
  if (!name) throw new Error(error);
  return `${IMAGE_DIR_NAME}/${name}`;
}

/** Opens a note as a preview; `content` is a function of the note's id, so it can refer to images stored for it. */
async function open(content: (noteId: number) => Promise<string>, screen = SCREEN): Promise<Rendered> {
  const note = await service.createNote("Guide", null);
  await service.saveNoteContent(note.id, `---\ntitle: Guide\n---\n\n${await content(note.id)}`);
  const app = await sandbox.mount(screen);
  await press(app, "RETURN", {}, 500); // a new pane starts as a split
  await press(app, "t", { ctrl: true }); // editor
  await press(app, "t", { ctrl: true }); // preview
  await settle(app, 1500); // the image is read and decoded, then drawn
  return app;
}

/** Where the drawn pictures are: each run of rows that hold block characters, as its size in cells. */
function pictures(app: Rendered): { row: number; column: number; columns: number; rows: number }[] {
  const lines = frame(app).split("\n");
  const found: { row: number; column: number; columns: number; rows: number }[] = [];
  let current: (typeof found)[number] | null = null;
  lines.forEach((line, row) => {
    const column = line.search(PICTURE_CELL);
    if (column < 0) {
      current = null;
      return;
    }
    const width = line.match(PICTURE_CELLS)?.length ?? 0;
    if (!current) found.push((current = { row, column, columns: width, rows: 0 }));
    current.columns = Math.max(current.columns, width);
    current.rows++;
  });
  return found;
}

type Rgb = [number, number, number];

// Which of a cell's four pixels a block character paints in the foreground color: upper left, upper right, lower left, lower right.
const QUADRANTS: Record<string, number> = {
  " ": 0, "▘": 1, "▝": 2, "▀": 3, "▖": 4, "▌": 5, "▞": 6, "▛": 7, "▗": 8, "▚": 9, "▐": 10, "▜": 11, "▄": 12, "▙": 13, "▟": 14, "█": 15,
};

const rgb = (color: unknown): Rgb => {
  const { buffer } = color as { buffer: ArrayLike<number> };
  const scale = buffer[0] > 1 || buffer[1] > 1 || buffer[2] > 1 ? 1 : 255; // 0-255, or 0-1 floats
  return [buffer[0] * scale, buffer[1] * scale, buffer[2] * scale];
};

/** The pixels a picture is drawn with on screen: each cell's glyph and colors read back as its 2x2 pixels. */
function drawnPixels(app: Rendered, at: { row: number; column: number; columns: number; rows: number }) {
  const { lines } = app.captureSpans() as unknown as { lines: { spans: { text: string; width: number; fg: unknown; bg: unknown }[] }[] };
  const width = at.columns * 2;
  const pixels: Rgb[] = new Array(width * at.rows * 2);
  for (let y = 0; y < at.rows; y++) {
    let column = 0;
    for (const span of lines[at.row + y].spans) {
      let x = column;
      for (const glyph of span.text) {
        if (x >= at.column && x < at.column + at.columns) {
          const mask = QUADRANTS[glyph] ?? 0;
          const [fg, bg] = [rgb(span.fg), rgb(span.bg)];
          for (let q = 0; q < 4; q++) pixels[(y * 2 + (q >> 1)) * width + (x - at.column) * 2 + (q & 1)] = mask & (1 << q) ? fg : bg;
        }
        x++;
      }
      column += span.width;
    }
  }
  return { pixels, width, height: at.rows * 2 };
}

describe("images in the preview", () => {
  it("draws a pasted image's pixels, in place of its Markdown, between the text around it", async () => {
    const app = await open(async (id) => `Before.\n\n![Green](${await store(id, makePng(60, 40, [0, 200, 0]))})\n\nAfter.`);

    const [picture] = pictures(app);
    expect(frame(app)).toContain("Before.");
    expect(frame(app)).toContain("After.");
    expect(frame(app)).not.toContain("app_data/");
    expect(frame(app)).not.toContain("Green"); // the alt text is for when there is no picture
    expect(picture).toBeDefined();
    const middle = { row: picture.row + Math.floor(picture.rows / 2), column: picture.column + Math.floor(picture.columns / 2) };
    expect(backgroundAt(app, middle.row, middle.column)).toBe("#00C800");
  });

  it("shows the picture's own colors, not one flat color", async () => {
    // Red on the left, blue on the right.
    const png = makePng(60, 40, (x) => (x < 30 ? [255, 0, 0] : [0, 0, 255]));
    const app = await open(async (id) => `![Flag](${await store(id, png)})`);

    const [picture] = pictures(app);
    const y = picture.row + 1;
    expect(backgroundAt(app, y, picture.column + 2)).toBe("#FF0000");
    expect(backgroundAt(app, y, picture.column + picture.columns - 3)).toBe("#0000FF");
  });

  it("keeps the image's proportions, and fits the pane", async () => {
    // 400x100: four times as wide as tall, which is eight times as many columns as rows, cells being twice as tall as wide.
    const app = await open(async (id) => `![Wide](${await store(id, makePng(400, 100))})`);

    const [picture] = pictures(app);
    expect(picture.columns).toBeLessThan(SCREEN.width - 34); // inside the pane, beside the tree
    expect(picture.columns / picture.rows).toBeGreaterThan(7.2);
    expect(picture.columns / picture.rows).toBeLessThan(8.8);
  });

  it("draws fine detail faithfully rather than as noise", async () => {
    // Stripes, a circle and one-pixel bars: what a screenshot or a photograph is made of.
    const picture = (x: number, y: number): Rgb => {
      if ((x - 300) ** 2 + (y - 200) ** 2 < 120 ** 2) return [230, 60, 60];
      if (y > 330) return x % 6 < 3 ? [20, 20, 20] : [235, 235, 235];
      return (x + y) % 40 < 20 ? [40, 90, 200] : [240, 240, 120];
    };
    const png = makePng(600, 400, picture);
    const app = await open(async (id) => `![Busy](${await store(id, png)})`);

    const [at] = pictures(app);
    const drawn = drawnPixels(app, at);
    // What the picture looks like averaged down to the pixels the screen has: the best that can be drawn.
    const original = NativeImage.decode(png);
    const best = original.resize({ width: drawn.width, height: drawn.height, kernel: "area" }).raw("rgba8");
    let error = 0;
    drawn.pixels.forEach((pixel, i) => {
      for (let c = 0; c < 3; c++) error += Math.abs(pixel[c] - best.data[i * 4 + c]);
    });
    const meanError = error / (drawn.pixels.length * 3);

    // Handing OpenTUI the full-size image instead leaves this near 40 (it picks pixels rather than averaging them).
    expect(meanError).toBeLessThan(16);
  });

  it("does not blow a small image up", async () => {
    const app = await open(async (id) => `![Icon](${await store(id, makePng(16, 16))})`);

    const [picture] = pictures(app);
    expect([picture.columns, picture.rows]).toEqual([8, 4]); // two pixels per column, four per row
  });

  it("does not let a tall image fill more than about 60% of the screen", async () => {
    const app = await open(async (id) => `![Tall](${await store(id, makePng(100, 400))})`);

    const [picture] = pictures(app);
    expect(picture.rows).toBe(Math.floor(SCREEN.height * 0.6));
    expect(picture.columns).toBeLessThan(25); // narrower, to keep its shape
  });

  it("draws an <Image> the same way", async () => {
    const app = await open(async (id) => `<Image src="${await store(id, makePng(40, 40, [0, 0, 255]))}" alt="Blue" />`);

    const [picture] = pictures(app);
    expect(backgroundAt(app, picture.row + 2, picture.column + 2)).toBe("#0000FF");
  });

  it("draws one inside an <Info> panel, within its border", async () => {
    const app = await open(async (id) => `<Info>\n\nCaption.\n\n![Green](${await store(id, makePng(300, 100, [0, 200, 0]))})\n\n</Info>`);

    const [picture] = pictures(app);
    const row = frame(app).split("\n")[picture.row];
    expect(frame(app)).toContain("╭─ Info ");
    expect(row.slice(picture.column - 2, picture.column)).toBe("│ "); // the panel's border and padding, to its left
    expect(row.trimEnd().endsWith("│")).toBe(true); // and its right border after the picture
  });

  it("draws every image of a paragraph that is only images, one under the other", async () => {
    const app = await open(async (id) => {
      const red = await store(id, makePng(20, 20, [255, 0, 0]), "red.png");
      const blue = await store(id, makePng(20, 20, [0, 0, 255]), "blue.png");
      return `![Red](${red})\n![Blue](${blue})`;
    });

    const found = pictures(app);
    expect(found).toHaveLength(2);
    expect(backgroundAt(app, found[0].row + 1, found[0].column + 1)).toBe("#FF0000");
    expect(backgroundAt(app, found[1].row + 1, found[1].column + 1)).toBe("#0000FF");
  });

  describe("when there is nothing to draw", () => {
    it("says so when the file has gone missing", async () => {
      const app = await open(async () => "![Lost trip](app_data/lost-0123456789ab.png)");

      expect(frame(app)).toContain("Image not found: Lost trip");
      expect(pictures(app)).toEqual([]);
    });

    it("says so when the file is not an image the terminal can decode", async () => {
      const app = await open(async () => {
        const dir = path.join(loadWebSettings().appDataDir, IMAGE_DIR_NAME);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "broken.png"), "this is not a picture");
        return "![Broken one](app_data/broken.png)";
      });

      expect(frame(app)).toContain("Can’t display this image: Broken one");
      expect(pictures(app)).toEqual([]);
    });

    it("shows an image on the network as its alt text: opening a note makes no request", async () => {
      const app = await open(async () => "![A remote one](https://example.com/a.png)");

      expect(frame(app)).toContain("A remote one");
      expect(pictures(app)).toEqual([]);
    });

    it("shows an image in the middle of a sentence as its alt text", async () => {
      const app = await open(async (id) => `See ![the map](${await store(id, makePng(30, 30))}) for the route.`);

      expect(frame(app)).toContain("See the map");
      expect(pictures(app)).toEqual([]);
    });

    it("names the file when an image has no alt text and is missing", async () => {
      const app = await open(async () => "![](app_data/nameless-0123456789ab.png)");

      expect(frame(app)).toContain("Image not found: nameless-0123456789ab.png");
    });
  });
});
