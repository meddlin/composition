import fs from "node:fs";
import { Readable } from "node:stream";

/**
 * Serves a PDF from disk the way a web server would, with byte ranges (spike A, docs/pdf-markup-plan.md). The reader asks
 * for a few kilobytes at a time, so a 300 MB textbook opens by reading about 10 MB, and this must stream a slice of the file
 * instead of reading the whole of it into memory, as the handler for the app's own files does.
 *
 * One range per request, which is all pdf.js asks for: `bytes=a-b`, `bytes=a-` and `bytes=-n` (the last n bytes). Anything
 * else is a 416, and a request with no range gets the whole file.
 */
export function servePdf(file: string, rangeHeader: string | null, method: string): Response {
  let size: number;
  try {
    const stats = fs.statSync(file);
    if (!stats.isFile()) return new Response("Not found", { status: 404 });
    size = stats.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const base = {
    "content-type": "application/pdf",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    // A PDF's bytes never change under its id, but the reader keeps what it has read; nothing else needs a copy kept.
    "cache-control": "no-store",
  };
  const body = (start: number, end: number) => (method === "HEAD" || size === 0 ? null : (Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream));

  if (rangeHeader === null) {
    return new Response(body(0, size - 1), { headers: { ...base, "content-length": String(size) } });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === "" && match[2] === "")) return new Response("Bad range", { status: 416, headers: { "content-range": `bytes */${size}` } });
  const [, first, last] = match;
  const start = first === "" ? Math.max(0, size - Number(last)) : Number(first);
  const end = first === "" || last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (size === 0 || start > end || start >= size) return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}` } });

  return new Response(body(start, end), {
    status: 206,
    headers: { ...base, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` },
  });
}

/** The id in `/documents/<id>`, or null for anything else (a name, a path, a negative number). */
export function documentIdFromPath(pathname: string): number | null {
  const match = /^\/documents\/(\d{1,15})$/.exec(pathname);
  return match ? Number(match[1]) : null;
}
