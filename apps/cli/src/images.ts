/**
 * Showing a note's images in the preview.
 *
 * An image is a file in `app_data/` that the note points at (`![alt](app_data/<name>)`, or
 * `<Image src="app_data/<name>" />`). This reads one, decodes it with OpenTUI's native decoder,
 * and works out how many terminal cells to draw it in. The drawing itself is OpenTUI's `<image>`,
 * which paints with the Kitty or Sixel graphics protocol where the terminal has one, and with
 * quadrant block characters anywhere else: each cell is a 2x2 grid of pixels in two colors.
 *
 * Only stored images are shown: a note's `https://` image would mean a network request just for
 * opening it, so those stay as text, as they were.
 */
import { NativeImage, resolveImageRenderProtocol, type ImageRenderProtocol } from "@opentui/core";
import type { Api } from "./api";

/**
 * Images are shrunk to this many pixels on their longer side when loaded. A terminal can't show
 * more, and a 4K screenshot is 33 MB once decoded.
 */
export const MAX_IMAGE_SIDE = 1600;

/** How many decoded images are kept, so scrolling back to one, or opening it in a second pane, doesn't decode it again. */
const MAX_CACHED = 16;

export type ImageLoad =
  | { image: NativeImage }
  /** `missing`: no such file. `unreadable`: the file isn't an image the decoder takes, or is too big for it. */
  | { failure: "missing" | "unreadable" };

// Keyed by file name, which holds the hash of the bytes: a name always means the same pixels, wherever the data folder is.
const cache = new Map<string, Promise<ImageLoad>>();

async function read(api: Pick<Api, "readImage">, name: string): Promise<ImageLoad> {
  const stored = await api.readImage(name);
  if (!stored) return { failure: "missing" };
  try {
    let image = NativeImage.decode(stored.data);
    if (Math.max(image.width, image.height) > MAX_IMAGE_SIDE) {
      const shrunk = image.resize(image.width >= image.height ? { width: MAX_IMAGE_SIDE } : { height: MAX_IMAGE_SIDE });
      image.dispose();
      image = shrunk;
    }
    return { image };
  } catch {
    return { failure: "unreadable" };
  }
}

/**
 * The stored image called `name`, decoded. The `image` is the caller's own reference to the
 * pixels: dispose it when done with it. The cache keeps another, so this is quick the second time.
 * A failure is not remembered, since the file may turn up later.
 */
export async function loadStoredImage(api: Pick<Api, "readImage">, name: string): Promise<ImageLoad> {
  let pending = cache.get(name);
  if (pending) {
    cache.delete(name); // most recently used goes last
  } else {
    pending = read(api, name);
  }
  cache.set(name, pending);

  const result = await pending;
  if (!("image" in result)) {
    if (cache.get(name) === pending) cache.delete(name);
    return result;
  }
  evictOldest();
  return { image: result.image.retain() };
}

function evictOldest(): void {
  while (cache.size > MAX_CACHED) {
    const [name, pending] = cache.entries().next().value!;
    cache.delete(name);
    void pending.then((result) => "image" in result && result.image.dispose());
  }
}

/** Forgets every decoded image. For tests, which would otherwise see each other's. */
export function clearImageCache(): void {
  for (const pending of cache.values()) void pending.then((result) => "image" in result && result.image.dispose());
  cache.clear();
}

// --- how big to draw it ----------------------------------------------------------------

export type Cells = { width: number; height: number };

/** What a terminal cell is, for fitting a picture to it. */
export type CellGeometry = {
  /** How many pixels of the image one cell shows at the image's natural size. */
  pixels: { width: number; height: number };
  /** The pixels OpenTUI samples for one cell: its grid of sub-pixels, or the terminal's own pixels. */
  grid: { width: number; height: number };
  /** How much taller a cell is than wide, on screen. */
  aspect: number;
};

/**
 * The picture OpenTUI draws for an image in a box: the largest that fits, in the image's
 * proportions (ImageRenderable.getFittedSize).
 */
function fitted(box: Cells, image: { width: number; height: number }, aspect: number): Cells {
  const displayAspect = (image.width / image.height) * aspect;
  const scale = Math.min(box.width / displayAspect, box.height);
  return { width: Math.max(1, Math.round(displayAspect * scale)), height: Math.max(1, Math.round(scale)) };
}

/**
 * The cells to draw an image in: as large as fits in `maxColumns` by `maxRows`, but never larger
 * than the image's own pixels, so a small icon isn't blown up. The box has the picture's
 * proportions, on the terminal's cell shape, to the cell.
 */
export function cellsForImage(
  image: { width: number; height: number },
  limit: { maxColumns: number; maxRows: number },
  { pixels, aspect }: CellGeometry,
): Cells {
  let box: Cells = {
    width: Math.min(limit.maxColumns, image.width / pixels.width),
    height: Math.min(limit.maxRows, image.height / pixels.height),
  };
  // Fitting a rounded box can round again; a few passes settle it.
  for (let pass = 0; pass < 4; pass++) {
    const next = fitted(box, image, aspect);
    if (next.width === box.width && next.height === box.height) break;
    box = next;
  }
  return { width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) };
}

/**
 * The size, in pixels, to shrink an image to before handing it to OpenTUI to draw in `cells`: the
 * grid it samples, exactly. Given a bigger image, OpenTUI picks pixels out of it rather than
 * averaging them, so fine detail (text, stripes, edges) turns into noise: against a properly
 * averaged picture, the error was six times larger. It is never more than the image has.
 */
export function pixelsForCells(cells: Cells, { grid }: CellGeometry, image: { width: number; height: number }): Cells {
  return {
    width: Math.max(1, Math.min(image.width, Math.round(cells.width * grid.width))),
    height: Math.max(1, Math.min(image.height, Math.round(cells.height * grid.height))),
  };
}

type RenderContext = {
  capabilities: Parameters<typeof resolveImageRenderProtocol>[1];
  terminalWidth?: number;
  terminalHeight?: number;
  resolution?: { width: number; height: number } | null;
};

/**
 * What a cell is on this terminal. Without a graphics protocol OpenTUI paints each cell with a
 * quadrant block character: a 2x2 grid of pixels in two colors. The graphics protocols draw at
 * the terminal's real resolution, so a cell is as many pixels as it is on screen. The aspect is
 * the terminal's real one when it reports its size in pixels (OpenTUI's `cellAspectRatio`), and 2
 * when it doesn't.
 */
export function cellGeometry(renderer: RenderContext, protocol: ImageRenderProtocol = "auto"): CellGeometry {
  const resolution = renderer.resolution;
  const known = !!resolution && !!renderer.terminalWidth && !!renderer.terminalHeight;
  const cell = known
    ? { width: resolution!.width / renderer.terminalWidth!, height: resolution!.height / renderer.terminalHeight! }
    : null;
  const aspect = cell && cell.width > 0 && cell.height > 0 ? cell.height / cell.width : 2;
  if (!cell || resolveImageRenderProtocol(protocol, renderer.capabilities, true) === "blocks") {
    // Two sub-pixels across and two down, each as tall as the cell is, relative to wide, so a source pixel is square at 2 across and 2 x aspect down.
    return { pixels: { width: 2, height: 2 * aspect }, grid: { width: 2, height: 2 }, aspect };
  }
  return { pixels: cell, grid: cell, aspect };
}

/** The protocol to draw with: `COMPOSITION_IMAGE_PROTOCOL` (auto, blocks, kitty or sixel), else the terminal's best. */
export function imageProtocol(env: Record<string, string | undefined> = process.env): ImageRenderProtocol {
  const requested = env.COMPOSITION_IMAGE_PROTOCOL?.trim().toLowerCase();
  return requested === "blocks" || requested === "kitty" || requested === "sixel" ? requested : "auto";
}
