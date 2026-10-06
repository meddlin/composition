import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import zlib from "node:zlib";

/**
 * A minimal streaming tar.gz writer and reader, for backups (backup.ts).
 *
 * Why not a library: a backup must stay readable by plain `tar -xzf` (so the
 * user is never locked in to this app), but it only ever needs regular files,
 * and the reader must be *strict* (it is fed files from anywhere), which is
 * easier to be when it is a hundred lines you can read than a general-purpose
 * extractor. Node has gzip built in; this adds the 512-byte-block framing.
 *
 * Written: ustar headers, GNU long names for paths over 100 bytes.
 * Read:    regular files only. A link, device, FIFO or anything else is refused
 *          rather than skipped, since skipping would hide a hostile archive.
 *          POSIX (`x`) and GNU (`L`) path extensions are understood, so an
 *          archive re-created with the system's `tar` still restores.
 */

const BLOCK = 512;

export class ArchiveError extends Error {}

/** A file to add: where it is on disk, and the path it gets inside the archive. */
export type ArchiveSource = { name: string; file: string };

/** A file's metadata and bytes, as read from an archive. `data` can be read once. */
export type ArchiveEntry = { name: string; size: number; data: Readable };

// --- writing -----------------------------------------------------------------

function octal(value: number, width: number): Buffer {
  return Buffer.from(value.toString(8).padStart(width - 1, "0") + "\0", "latin1");
}

function header(name: string, size: number, mtime: number, type: "0" | "L"): Buffer {
  const block = Buffer.alloc(BLOCK);
  const nameBytes = Buffer.from(name, "utf8");
  nameBytes.copy(block, 0, 0, Math.min(nameBytes.length, 100));
  octal(0o644, 8).copy(block, 100);
  octal(0, 8).copy(block, 108); // uid
  octal(0, 8).copy(block, 116); // gid
  octal(size, 12).copy(block, 124);
  octal(mtime, 12).copy(block, 136);
  block.fill(0x20, 148, 156); // the checksum is computed with this field as spaces
  block.write(type, 156, "latin1");
  block.write("ustar\0", 257, "latin1");
  block.write("00", 263, "latin1");
  let sum = 0;
  for (const byte of block) sum += byte;
  Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ", "latin1").copy(block, 148);
  return block;
}

const padding = (size: number): Buffer => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** The text of `name` as a GNU long-name entry, for paths a ustar header can't hold. */
function* longName(name: string): Generator<Buffer> {
  const bytes = Buffer.concat([Buffer.from(name, "utf8"), Buffer.from([0])]);
  yield header("././@LongLink", bytes.length, 0, "L");
  yield bytes;
  yield padding(bytes.length);
}

async function* entries(sources: readonly ArchiveSource[], contents: ReadonlyMap<string, Buffer>): AsyncGenerator<Buffer> {
  const mtime = Math.floor(Date.now() / 1000);
  const add = async function* (name: string, size: number): AsyncGenerator<Buffer> {
    if (Buffer.byteLength(name) > 100) yield* longName(name);
    yield header(name, size, mtime, "0");
  };

  for (const [name, bytes] of contents) {
    yield* add(name, bytes.length);
    yield bytes;
    yield padding(bytes.length);
  }

  for (const { name, file } of sources) {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(file, "r");
    } catch (error) {
      // Gone since the folder was listed (an attachment removed meanwhile): not part of the backup.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    try {
      // The size is read from the open file, so the header and the bytes cannot disagree.
      const { size } = await handle.stat();
      yield* add(name, size);
      let remaining = size;
      const chunk = Buffer.alloc(64 * 1024);
      while (remaining > 0) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, remaining), null);
        if (bytesRead === 0) throw new ArchiveError(`${file} shrank while it was being backed up.`);
        remaining -= bytesRead;
        yield Buffer.from(chunk.subarray(0, bytesRead));
      }
      yield padding(size);
    } finally {
      await handle.close();
    }
  }
  yield Buffer.alloc(BLOCK * 2); // end of archive
}

/**
 * Writes a .tar.gz at `target`: first `contents` (small files held in memory,
 * such as the manifest), then each source streamed from disk. Written to a
 * temporary name and renamed, so `target` is never a half-written archive.
 */
export async function writeArchive(
  target: string,
  contents: ReadonlyMap<string, Buffer>,
  sources: readonly ArchiveSource[],
): Promise<void> {
  const temporary = `${target}.partial`;
  try {
    await pipeline(
      Readable.from(entries(sources, contents)),
      zlib.createGzip(),
      fs.createWriteStream(temporary, { mode: 0o600 }),
    );
    await fs.promises.rename(temporary, target);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

// --- reading -----------------------------------------------------------------

/** Pulls exact byte counts out of a stream of arbitrary chunks. */
class ByteReader {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private done = false;
  private readonly iterator: AsyncIterator<Buffer>;

  constructor(source: AsyncIterable<Buffer>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  private async fill(): Promise<boolean> {
    if (this.done) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.done = true;
      return false;
    }
    this.chunks.push(next.value);
    this.buffered += next.value.length;
    return true;
  }

  /** Up to `count` bytes (fewer only at the end of the stream), as one buffer. */
  async take(count: number): Promise<Buffer> {
    while (this.buffered < count && (await this.fill())) {
      // keep reading
    }
    const joined = Buffer.concat(this.chunks);
    const taken = joined.subarray(0, Math.min(count, joined.length));
    const rest = joined.subarray(taken.length);
    this.chunks = rest.length > 0 ? [rest] : [];
    this.buffered = rest.length;
    return taken;
  }

  /** Throws away `count` bytes. */
  async skip(count: number): Promise<void> {
    while (count > 0) {
      const taken = await this.take(Math.min(count, 1024 * 1024));
      if (taken.length === 0) throw new ArchiveError("The backup ends unexpectedly.");
      count -= taken.length;
    }
  }
}

function parseOctal(field: Buffer): number {
  const text = cString(field).trim();
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError("The backup has a damaged header.");
  return parseInt(text, 8);
}

function cString(field: Buffer): string {
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function checksumMatches(block: Buffer): boolean {
  const stored = parseOctal(block.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  return sum === stored;
}

/** `path=…` from a POSIX extended header's `<length> <key>=<value>\n` records. */
function paxPath(records: Buffer): string | null {
  let at = 0;
  while (at < records.length) {
    const space = records.indexOf(0x20, at);
    const length = Number(records.subarray(at, space).toString("latin1"));
    if (space === -1 || !Number.isInteger(length) || length <= 0) {
      throw new ArchiveError("The backup has a damaged header.");
    }
    const record = records.subarray(space + 1, at + length - 1).toString("utf8");
    if (record.startsWith("path=")) return record.slice("path=".length);
    at += length;
  }
  return null;
}

const MAX_EXTENSION_BYTES = 64 * 1024;

/**
 * Reads the archive at `file` one entry at a time. `visit` should read
 * `entry.data` to the end before it returns (what it leaves is skipped).
 * Anything that is not a plain file or a folder is an error.
 */
export async function readArchive(file: string, visit: (entry: ArchiveEntry) => Promise<void>): Promise<void> {
  const input = fs.createReadStream(file);
  const source = zlib.createGunzip();
  // `pipe` doesn't forward a failure to read the file, so do it here.
  input.on("error", (error) => source.destroy(error));
  input.pipe(source);
  const reader = new ByteReader(source);

  try {
    let pendingName: string | null = null;
    for (;;) {
      const block = await reader.take(BLOCK);
      if (block.length < BLOCK) throw new ArchiveError("The backup ends unexpectedly.");
      if (block.every((byte) => byte === 0)) return; // end of archive
      if (!checksumMatches(block)) throw new ArchiveError("This is not a Composition backup (or it is damaged).");

      const type = String.fromCharCode(block[156] || 0x30);
      const size = parseOctal(block.subarray(124, 136));
      const prefix = cString(block.subarray(345, 500));
      const name = pendingName ?? (prefix ? `${prefix}/${cString(block.subarray(0, 100))}` : cString(block.subarray(0, 100)));
      pendingName = null;
      const padded = Math.ceil(size / BLOCK) * BLOCK;

      if (type === "L" || type === "x") {
        if (size > MAX_EXTENSION_BYTES) throw new ArchiveError("The backup has a damaged header.");
        const body = await reader.take(padded);
        if (body.length < padded) throw new ArchiveError("The backup ends unexpectedly.");
        const content = body.subarray(0, size);
        pendingName = type === "L" ? cString(content) : paxPath(content);
        continue;
      }
      if (type === "g" || type === "5") {
        await reader.skip(padded);
        continue;
      }
      if (type !== "0") {
        throw new ArchiveError(`The backup contains something other than files (${name || "an unnamed entry"}), so it was not restored.`);
      }

      // Hand the file's bytes out as a stream that stops at its size.
      let remaining = size;
      const data = new Readable({
        async read() {
          try {
            if (remaining === 0) return void this.push(null);
            const chunk = await reader.take(Math.min(remaining, 64 * 1024));
            if (chunk.length === 0) throw new ArchiveError("The backup ends unexpectedly.");
            remaining -= chunk.length;
            this.push(chunk);
          } catch (error) {
            this.destroy(error as Error);
          }
        },
      });
      await visit({ name, size, data });
      // Whatever the visitor left unread, and the padding after the data.
      data.destroy();
      await reader.skip(remaining);
      await reader.skip(padded - size);
    }
  } catch (error) {
    source.destroy();
    if (error instanceof ArchiveError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string" && code.startsWith("Z_")) {
      throw new ArchiveError("This is not a Composition backup (or it is damaged).");
    }
    throw error;
  }
}
