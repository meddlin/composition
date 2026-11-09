import { INK_DENSITY, INK_LIMITS, InkError, parseInkText, type InkDrawing } from "./ink";

/**
 * The PNG that carries its own strokes (docs/architecture/ink.md, "The container"): the drawing's pixels as any PNG, plus
 * private chunks before IEND. Everything that shows an image sees the pixels and ignores the chunks; this reads the one a
 * web or desktop renderer needs:
 *
 *   inKJ  the stroke JSON:  version byte (1) · length of the text, 4 bytes big endian · the text as a zlib stream
 *
 * (`inKP`, PencilKit's own blob, is for the iPad's lossless re-edit and is not read here.) A chunk that is damaged, of a
 * newer version, or that does not unpack is reported in `problems` and the PNG is shown as the picture it is. Pure
 * apart from the decompression (the platform's `DecompressionStream`), so it runs in the renderer and in tests.
 */

export const INK_JSON_CHUNK = "inKJ";
const CHUNK_VERSION = 1;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type InkChunk = {
  /** The stroke JSON's text as stored; null when the PNG carries none, or none that could be read. */
  json: Uint8Array | null;
  problems: string[];
};

export type InkPngContents = {
  /** The drawing the PNG carries; null when it carries none, or none that could be read (then it is just a picture). */
  drawing: InkDrawing | null;
  problems: string[];
};

/**
 * The drawing a PNG carries. A PNG without the chunk is not an error (`drawing` is null, and `problems` is empty). A PNG
 * whose structure is broken is: the caller shows it as a picture, if the browser can.
 */
export async function readInkPng(png: Uint8Array): Promise<InkPngContents> {
  const { json, problems } = await readInkChunk(png);
  if (!json) return { drawing: null, problems };
  try {
    return { drawing: parseInkText(new TextDecoder("utf-8", { fatal: true }).decode(json)), problems };
  } catch (error) {
    const reason = error instanceof InkError ? error.message : "This drawing's text is not UTF-8.";
    return { drawing: null, problems: [...problems, reason] };
  }
}

/** The `inKJ` chunk of a PNG, checked and unpacked: its CRC, its version, and that it unpacks to the length it says. */
export async function readInkChunk(png: Uint8Array): Promise<InkChunk> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const result: InkChunk = { json: null, problems: [] };
  for (const chunk of walk(png, view)) {
    if (chunk.type !== INK_JSON_CHUNK) continue;
    // The CRC covers the type and the data, not the length.
    if (crc32(png.subarray(chunk.start + 4, chunk.end - 4)) !== view.getUint32(chunk.end - 4)) {
      result.problems.push(`The ${INK_JSON_CHUNK} chunk is damaged.`);
      continue;
    }
    const body = png.subarray(chunk.start + 8, chunk.end - 4);
    if (body[0] !== CHUNK_VERSION) {
      result.problems.push(`The ${INK_JSON_CHUNK} chunk is from a newer version.`);
      continue;
    }
    if (body.length < 5) {
      result.problems.push(`The ${INK_JSON_CHUNK} chunk is short.`);
      continue;
    }
    const size = new DataView(body.buffer, body.byteOffset + 1, 4).getUint32(0);
    const text = size <= INK_LIMITS.jsonBytes ? await inflate(body.subarray(5), size) : null;
    if (!text) {
      result.problems.push(`The ${INK_JSON_CHUNK} chunk does not unpack.`);
      continue;
    }
    result.json = text;
  }
  return result;
}

/**
 * How many pixels the PNG has to a point of its drawing's canvas: its `pHYs` chunk (pixels to a metre, where 72 dots to an inch is a pixel to a point), to a
 * hundredth. 2 when it has no usable one (not in metres, not square, none) or its structure is broken: every drawing before the chunk was written is 2x, and 2
 * is what the iPad draws at. A drawing too big for 2 pixels to a point (over 4,096 points on a side) is stored at less, and says so here.
 */
export function pixelsPerPoint(png: Uint8Array): number {
  try {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const phys = walk(png, view).find((chunk) => chunk.type === "pHYs");
    if (!phys || phys.end - phys.start !== 12 + 9) return INK_DENSITY;
    const x = view.getUint32(phys.start + 8);
    const y = view.getUint32(phys.start + 12);
    if (png[phys.start + 16] !== 1 || x !== y || x === 0) return INK_DENSITY;
    const density = Math.round(((x * 0.0254) / 72) * 100) / 100;
    return density > 0 ? density : INK_DENSITY;
  } catch {
    return INK_DENSITY;
  }
}

type Chunk = { type: string; /** Offsets in the file of the length field, and of the end of the CRC. */ start: number; end: number };

/** The chunks of a PNG in order, checked for structure (signature, lengths, IHDR first, IEND last) but not for CRCs. */
function walk(png: Uint8Array, view: DataView): Chunk[] {
  if (png.length < SIGNATURE.length + 12 || !SIGNATURE.every((byte, index) => png[index] === byte)) throw new InkError("This is not a PNG.");
  const chunks: Chunk[] = [];
  let offset = SIGNATURE.length;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (length > 0x7fff_ffff || end > png.length) throw new InkError("This PNG is cut short.");
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (chunks.length === 0 && type !== "IHDR") throw new InkError("This PNG does not start with its header.");
    chunks.push({ type, start: offset, end });
    offset = end;
    if (type === "IEND") break;
  }
  if (chunks.at(-1)?.type !== "IEND") throw new InkError("This PNG has no end.");
  return chunks;
}

/** The `size` bytes a zlib stream holds, or null when it holds anything else (or is not a zlib stream). Never holds more than `size`. */
async function inflate(data: Uint8Array, size: number): Promise<Uint8Array | null> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  // A damaged stream fails the reader below too; these only keep the same failure from being reported twice.
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});

  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      // A hostile stream may unpack to far more than it says: stop at the first byte too many.
      if (total > size) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } catch {
    return null;
  }
  if (total !== size) return null;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** The CRC-32 PNG chunks use (the zlib one). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
