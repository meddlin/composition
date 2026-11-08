/** Zip files for tests: a stored archive of text entries, and its entries read back. Not shipped; the reader of real files is sheetTables.ts. */

/** A zip file of these entries, stored with no compression: enough to hand SheetJS a workbook whose XML is written by hand. */
export function zip(files: Record<string, string>): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Uint8Array) => (bytes.reduce((c, byte) => crcTable[(c ^ byte) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...data]);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes]));
    parts.push(local);
    offset += local.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(centralSize), ...u32(offset), ...u16(0)]);
  return Uint8Array.from([...parts.flatMap((part) => [...part]), ...central.flatMap((part) => [...part]), ...end]);
}


/** The entries of a stored zip made by `zip` above, to build on. */
export function unzipToFiles(archive: Uint8Array): Record<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = decoder.decode(archive.subarray(at + 30, at + 30 + nameLength));
    files[name] = decoder.decode(archive.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    at += 30 + nameLength + size;
  }
  return files;
}



/** The same as `zip`, with each entry deflated (method 8), as real files are. */
export async function zipDeflated(files: Record<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const deflated: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    const stream = new Blob([encoder.encode(content) as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    deflated[name] = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const stored = zip(files); // the entry headers, which hold the sizes and the checksums, are rebuilt below
  const view = new DataView(stored.buffer, stored.byteOffset, stored.byteLength);
  // Walk the stored archive's local headers and rebuild each entry with the deflated data.
  const out: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  let at = 0;
  const decoder = new TextDecoder();
  while (view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const nameBytes = stored.subarray(at + 30, at + 30 + nameLength);
    const data = deflated[decoder.decode(nameBytes)];
    const offset = out.length;
    out.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(size), ...u16(nameLength), ...u16(0), ...nameBytes, ...data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(size), ...u16(nameLength), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
    at += 30 + nameLength + size;
  }
  const entries = Object.keys(files).length;
  return Uint8Array.from([...out, ...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries), ...u16(entries), ...u32(central.length), ...u32(out.length), ...u16(0)]);
}
