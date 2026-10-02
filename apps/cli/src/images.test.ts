import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cellGeometry, cellsForImage, clearImageCache, imageProtocol, loadStoredImage, MAX_IMAGE_SIDE, pixelsForCells } from "./images";
import { makePng } from "./testImages";

describe("cellsForImage", () => {
  // Quadrant blocks: a cell is 2 sub-pixels across and 2 down, and shows 2 x 4 source pixels at their natural size.
  const blocks = { pixels: { width: 2, height: 4 }, grid: { width: 2, height: 2 }, aspect: 2 };

  it("fits an image to the width it is given, keeping its proportions", () => {
    // 200x100 pixels is 100 columns by 25 rows; in 50 columns it is 12.5 rows.
    expect(cellsForImage({ width: 200, height: 100 }, { maxColumns: 50, maxRows: 40 }, blocks)).toEqual({ width: 50, height: 13 });
  });

  it("fits an image to the height it is given", () => {
    // 100x400 pixels is 50 columns by 100 rows; 20 rows is a fifth of that.
    expect(cellsForImage({ width: 100, height: 400 }, { maxColumns: 80, maxRows: 20 }, blocks)).toEqual({ width: 10, height: 20 });
  });

  it("never draws an image larger than its own pixels", () => {
    expect(cellsForImage({ width: 16, height: 16 }, { maxColumns: 100, maxRows: 40 }, blocks)).toEqual({ width: 8, height: 4 });
  });

  it("counts a terminal's real cell size when it draws at full resolution", () => {
    // Cells of 10x20 pixels: a 400x400 image is 40 columns by 20 rows, and fits as it is.
    const kitty = { pixels: { width: 10, height: 20 }, grid: { width: 10, height: 20 }, aspect: 2 };
    expect(cellsForImage({ width: 400, height: 400 }, { maxColumns: 80, maxRows: 40 }, kitty)).toEqual({ width: 40, height: 20 });
  });

  it("is at least one cell, however thin the image", () => {
    expect(cellsForImage({ width: 1000, height: 1 }, { maxColumns: 50, maxRows: 40 }, blocks)).toEqual({ width: 50, height: 1 });
  });

  it("allows for a cell that is not exactly twice as tall as it is wide", () => {
    // Cells 7 pixels wide and 15 tall are 2.14 times as tall as wide, so a square image is drawn in
    // proportionally fewer rows than columns.
    const tall = { pixels: { width: 2, height: 2 * (15 / 7) }, grid: { width: 2, height: 2 }, aspect: 15 / 7 };
    const { width, height } = cellsForImage({ width: 100, height: 100 }, { maxColumns: 100, maxRows: 100 }, tall);
    expect(width / height).toBeCloseTo(15 / 7, 0);
  });

  it("settles on a box whose proportions don't drift when it is fitted again", () => {
    for (const [w, h, columns] of [[300, 100, 98], [300, 100, 99], [640, 480, 97], [333, 777, 61], [1600, 900, 100]]) {
      const cells = cellsForImage({ width: w, height: h }, { maxColumns: columns, maxRows: 40 }, blocks);
      const again = cellsForImage({ width: w, height: h }, { maxColumns: cells.width, maxRows: cells.height }, blocks);
      expect(again, `${w}x${h} in ${columns}`).toEqual(cells);
      expect(cells.width).toBeLessThanOrEqual(columns);
    }
  });
});

describe("pixelsForCells", () => {
  const blocks = { pixels: { width: 2, height: 4 }, grid: { width: 2, height: 2 }, aspect: 2 };

  it("is the grid OpenTUI samples: two sub-pixels across and two down per cell, in quadrant blocks", () => {
    expect(pixelsForCells({ width: 50, height: 13 }, blocks, { width: 1600, height: 800 })).toEqual({ width: 100, height: 26 });
  });

  it("is the terminal's own pixels under a graphics protocol", () => {
    const kitty = { pixels: { width: 10, height: 20 }, grid: { width: 10, height: 20 }, aspect: 2 };
    expect(pixelsForCells({ width: 40, height: 20 }, kitty, { width: 1600, height: 800 })).toEqual({ width: 400, height: 400 });
  });

  it("is never more than the image has", () => {
    expect(pixelsForCells({ width: 8, height: 4 }, blocks, { width: 16, height: 16 })).toEqual({ width: 16, height: 8 });
    expect(pixelsForCells({ width: 50, height: 50 }, blocks, { width: 30, height: 20 })).toEqual({ width: 30, height: 20 });
  });
});

describe("cellGeometry", () => {
  const kitty = { kitty_graphics: true, multiplexer: "none" } as never;
  const sized = { terminalWidth: 100, terminalHeight: 50, resolution: { width: 1000, height: 1000 } };
  const blocks = { pixels: { width: 2, height: 4 }, grid: { width: 2, height: 2 }, aspect: 2 };

  it("is quadrant blocks in cells twice as tall as wide when the terminal's pixel size isn't known", () => {
    expect(cellGeometry({ capabilities: null })).toEqual(blocks);
    expect(cellGeometry({ capabilities: kitty, terminalWidth: 100, terminalHeight: 50, resolution: null })).toEqual(blocks);
  });

  it("is quadrant blocks on the terminal's real cell shape, without a graphics protocol", () => {
    const plain = { capabilities: { kitty_graphics: false, multiplexer: "none" } as never, ...sized };
    expect(cellGeometry(plain)).toEqual(blocks);
    const geometry = cellGeometry({ ...plain, resolution: { width: 700, height: 750 } }); // cells 7 wide, 15 tall
    expect(geometry.aspect).toBeCloseTo(15 / 7, 5);
    expect(geometry.grid).toEqual({ width: 2, height: 2 });
    expect(geometry.pixels.height).toBeCloseTo(2 * (15 / 7), 5);
  });

  it("is the terminal's real cell size under the Kitty protocol", () => {
    const cell = { width: 10, height: 20 };
    expect(cellGeometry({ capabilities: kitty, ...sized })).toEqual({ pixels: cell, grid: cell, aspect: 2 });
  });

  it("is quadrant blocks when asked for them, whatever the terminal could do", () => {
    expect(cellGeometry({ capabilities: kitty, ...sized }, "blocks").grid).toEqual({ width: 2, height: 2 });
  });
});

describe("imageProtocol", () => {
  it("is auto unless COMPOSITION_IMAGE_PROTOCOL names one", () => {
    expect(imageProtocol({})).toBe("auto");
    expect(imageProtocol({ COMPOSITION_IMAGE_PROTOCOL: "blocks" })).toBe("blocks");
    expect(imageProtocol({ COMPOSITION_IMAGE_PROTOCOL: " Kitty " })).toBe("kitty");
    expect(imageProtocol({ COMPOSITION_IMAGE_PROTOCOL: "sixel" })).toBe("sixel");
    expect(imageProtocol({ COMPOSITION_IMAGE_PROTOCOL: "auto" })).toBe("auto");
    expect(imageProtocol({ COMPOSITION_IMAGE_PROTOCOL: "ascii-art" })).toBe("auto");
  });
});

describe("loadStoredImage", () => {
  const stored = (data: Uint8Array) => ({ data: Buffer.from(data), contentType: "image/png" });
  const apiReading = (data: Uint8Array | null) => ({ readImage: vi.fn(async () => (data ? stored(data) : null)) });

  beforeEach(clearImageCache);
  afterEach(clearImageCache);

  it("decodes the stored image", async () => {
    const api = apiReading(makePng(30, 20));

    const result = await loadStoredImage(api, "a.png");

    expect("image" in result && [result.image.width, result.image.height]).toEqual([30, 20]);
    expect(api.readImage).toHaveBeenCalledWith("a.png");
  });

  it("reads and decodes a name once, and hands each caller its own reference", async () => {
    const api = apiReading(makePng(8, 8));

    const first = await loadStoredImage(api, "a.png");
    const second = await loadStoredImage(api, "a.png");

    expect(api.readImage).toHaveBeenCalledTimes(1);
    if (!("image" in first) || !("image" in second)) throw new Error("expected images");
    expect(second.image).not.toBe(first.image);
    first.image.dispose(); // one caller finishing with its copy...
    expect(second.image.width).toBe(8); // ...leaves the other's alone
  });

  it("reads once when two are asked for at the same time", async () => {
    const api = apiReading(makePng(8, 8));

    await Promise.all([loadStoredImage(api, "a.png"), loadStoredImage(api, "a.png")]);

    expect(api.readImage).toHaveBeenCalledTimes(1);
  });

  it("says when the file is missing, and tries again next time since it may turn up", async () => {
    const api = apiReading(null);

    expect(await loadStoredImage(api, "gone.png")).toEqual({ failure: "missing" });
    expect(await loadStoredImage(api, "gone.png")).toEqual({ failure: "missing" });
    expect(api.readImage).toHaveBeenCalledTimes(2);
  });

  it("says when the bytes aren't an image the decoder takes", async () => {
    const api = apiReading(new TextEncoder().encode("this is not a picture"));

    expect(await loadStoredImage(api, "bad.png")).toEqual({ failure: "unreadable" });
  });

  it(`shrinks an image to ${MAX_IMAGE_SIDE} pixels on its longer side`, async () => {
    const wide = await loadStoredImage(apiReading(makePng(MAX_IMAGE_SIDE * 2, 10)), "wide.png");
    const tall = await loadStoredImage(apiReading(makePng(10, MAX_IMAGE_SIDE * 2)), "tall.png");

    expect("image" in wide && [wide.image.width, wide.image.height]).toEqual([MAX_IMAGE_SIDE, 5]);
    expect("image" in tall && [tall.image.width, tall.image.height]).toEqual([5, MAX_IMAGE_SIDE]);
  });

  it("keeps working for images already handed out when older ones are forgotten", async () => {
    const api = apiReading(makePng(4, 4));
    const first = await loadStoredImage(api, "first.png");

    for (let i = 0; i < 40; i++) await loadStoredImage(api, `other-${i}.png`); // far more than it keeps

    if (!("image" in first)) throw new Error("expected an image");
    expect(first.image.width).toBe(4);
    await loadStoredImage(api, "first.png");
    expect(api.readImage).toHaveBeenCalledTimes(42); // first.png had been forgotten, so it was read again
  });
});
