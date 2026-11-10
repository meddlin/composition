import { INK_DENSITY, type InkDrawing } from "./ink";
import { pixelsPerPoint, readInkPng } from "./inkPng";
import { imageUrl } from "./imageUrl";

/**
 * The drawing a stored PNG carries, fetched from wherever this build serves stored images (`imageUrl`) and read from its
 * `inKJ` chunk (docs/architecture/ink.md). Resolves null when the PNG is only a picture: it carries no strokes, or its
 * chunk is damaged, of a newer version, or its strokes can't be read. Rejects when the file can't be fetched at all.
 *
 * A stored image's name embeds a hash of its bytes (an edited drawing is a new file), so what a name gave once it gives
 * again: the answer is kept for the page's life, the preview and the live editor asking for the same drawing as often as
 * they redraw it. A failed fetch is not kept, so the next draw tries again.
 */
const cache = new Map<string, Promise<LoadedInk>>();

type LoadedInk = { drawing: InkDrawing | null; density: number };

/** Most drawings kept; a page of notes shows a few at a time, and each can be megabytes of strokes. */
const KEPT = 24;

export function loadInkDrawing(name: string): Promise<InkDrawing | null> {
  return load(name).then(({ drawing }) => drawing);
}

/**
 * How many pixels the stored PNG has to a point of its canvas (its `pHYs` chunk: `pixelsPerPoint`), for drawing it as the picture it is when its strokes
 * can't be read. From the same fetch as `loadInkDrawing`'s. Rejects when the file can't be fetched.
 */
export function loadInkDensity(name: string): Promise<number> {
  return load(name).then(({ density }) => density);
}

function load(name: string): Promise<LoadedInk> {
  const known = cache.get(name);
  if (known) {
    // Most recently used last, so the oldest is the one to go.
    cache.delete(name);
    cache.set(name, known);
    return known;
  }
  const loading = fetchDrawing(name).catch((error: unknown) => {
    cache.delete(name);
    throw error;
  });
  cache.set(name, loading);
  if (cache.size > KEPT) cache.delete(cache.keys().next().value!);
  return loading;
}

async function fetchDrawing(name: string): Promise<LoadedInk> {
  const response = await fetch(imageUrl(name));
  if (!response.ok) throw new Error(`The drawing ${name} could not be fetched (${response.status}).`);
  const png = new Uint8Array(await response.arrayBuffer());
  try {
    const { drawing } = await readInkPng(png);
    return { drawing, density: pixelsPerPoint(png) };
  } catch {
    // A PNG whose structure is broken is shown as the picture it is, if the browser can.
    return { drawing: null, density: INK_DENSITY };
  }
}

/** Forgets what was fetched, for tests. */
export function forgetInkDrawings(): void {
  cache.clear();
}
