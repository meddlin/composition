import type { PDFDocumentProxy } from "pdfjs-dist";
import { documentUrl } from "@/lib/composition/documentUrl";

/**
 * pdf.js, loaded the first time a PDF is opened and not before: it needs a browser (it reads `DOMMatrix` and friends when
 * it loads), so it can neither be imported by the static export's prerender nor weigh on the pages that never show a PDF.
 * What it was measured doing under the app's own scheme and security policy is in docs/pdf-markup-plan.md (spike A).
 */
export type Pdfjs = {
  lib: typeof import("pdfjs-dist");
  viewer: typeof import("pdfjs-dist/web/pdf_viewer.mjs");
};

let loaded: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  loaded ??= (async () => {
    const lib = await import("pdfjs-dist");
    // The viewer components read the core library from `globalThis.pdfjsLib` when they load, so it is put there first.
    (globalThis as { pdfjsLib?: unknown }).pdfjsLib = lib;
    const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
    // Copied out of the package into public/pdfjs/ by `pnpm copy:pdfjs`, which the desktop build and dev loop run.
    lib.GlobalWorkerOptions.workerSrc = `${location.origin}/pdfjs/pdf.worker.mjs`;
    return { lib, viewer };
  })();
  return loaded;
}

/** Where pdf.js finds its CMaps, standard fonts and ICC profiles. */
const assets = () => `${location.origin}/pdfjs/`;

/**
 * pdf.js reads only the parts of a file it needs, but it asks the server for ranges only when the URL is http(s); under
 * the app's own scheme it would ask for the whole file, and a 300 MB textbook would be read into memory to show a page.
 * So the ranges are fetched here and handed to it. A small chunk size matters: opening walks the page tree and reads one
 * chunk per page, so 512 KB chunks read 297 MB to open a 405 MB file and 16 KB chunks read 9.5 MB (spike A).
 */
const RANGE_CHUNK_SIZE = 16 * 1024;
/** The first bytes asked for: enough for the header and, usually, the trailer's position. */
const FIRST_BYTES = 64 * 1024;

export class PdfFileError extends Error {}

/**
 * The PDF needs a password to open: none was given (`incorrect` false), or the one given is not right (`incorrect` true). The
 * message says nothing of the password; callers ask the user and try again with `openPdf(id, password)`.
 */
export class PdfPasswordError extends Error {
  constructor(readonly incorrect: boolean) {
    super(incorrect ? "The password is not right." : "This PDF is protected by a password.");
  }
}

/** pdf.js's `PasswordResponses.INCORRECT_PASSWORD`; the other code it raises with a `PasswordException` is NEED_PASSWORD (1). */
const INCORRECT_PASSWORD = 2;

export type OpenedPdf = { doc: PDFDocumentProxy; destroy: () => void };

/**
 * Opens the PDF with this id, with `password` if it has one (the password is handed to pdf.js and goes nowhere else). Throws
 * `PdfPasswordError` when it needs one that was not given or is not right, and `PdfFileError` with a message to show when its
 * bytes can't be read.
 */
export async function openPdf(documentId: number, password?: string): Promise<OpenedPdf> {
  const { lib } = await loadPdfjs();
  const url = documentUrl(documentId);

  let first: Response;
  try {
    first = await fetch(url, { headers: { Range: `bytes=0-${FIRST_BYTES - 1}` } });
  } catch {
    throw new PdfFileError("The PDF could not be read.");
  }
  if (first.status === 404) throw new PdfFileError("This PDF's file is missing from the application data folder.");
  if (!first.ok) throw new PdfFileError(`The PDF could not be read (${first.status}).`);
  const firstBytes = new Uint8Array(await first.arrayBuffer());
  const total = Number(first.headers.get("content-range")?.split("/")[1]);
  if (!Number.isSafeInteger(total) || total <= 0) throw new PdfFileError("The PDF is empty or could not be sized.");

  class AppRangeTransport extends lib.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.arrayBuffer();
        })
        .then((buffer) => this.onDataRange(begin, new Uint8Array(buffer)))
        // Without this pdf.js would wait for bytes that are never coming.
        .catch(() => this.abort());
    }
  }

  const task = lib.getDocument({
    range: new AppRangeTransport(total, firstBytes),
    rangeChunkSize: RANGE_CHUNK_SIZE,
    disableAutoFetch: true,
    disableStream: true,
    // The app's policy allows no WebAssembly: a few image codecs run as JavaScript instead.
    useWasm: false,
    enableXfa: false,
    cMapUrl: `${assets()}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets()}standard_fonts/`,
    iccUrl: `${assets()}iccs/`,
    ...(password === undefined ? {} : { password }),
  });
  try {
    const doc = await task.promise;
    return { doc, destroy: () => void task.destroy() };
  } catch (error) {
    void task.destroy();
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") throw new PdfPasswordError((error as { code?: number }).code === INCORRECT_PASSWORD);
    if (name === "InvalidPDFException") throw new PdfFileError("This file is not a PDF Composition can read.");
    throw new PdfFileError("The PDF could not be opened.");
  }
}
