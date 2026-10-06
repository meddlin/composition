import zlib from "node:zlib";

/**
 * A real PNG, made in memory, for tests that need an image the decoder will take. `pixel` gives
 * each pixel's [r, g, b]; a plain array is one color for the whole image.
 */
export function makePng(
  width: number,
  height: number,
  pixel: [number, number, number] | ((x: number, y: number) => [number, number, number]) = [255, 0, 0],
): Uint8Array {
  const at = typeof pixel === "function" ? pixel : () => pixel;
  const rows = Buffer.alloc((width * 3 + 1) * height); // each row: a filter byte (0: none), then its pixels
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) rows.set(at(x, y), row + 1 + x * 3);
  }

  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, no filter, no interlace

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
