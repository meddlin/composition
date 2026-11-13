import fs from "node:fs";
import * as pdfjs from "../../../web/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "../../../web/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs";
import { readPdfText, type PdfjsForText, type PdfTextOutcome } from "../../../web/src/lib/composition/pdfText";
import type { PdfTextJob } from "../main/pdfText";

// pdf.js parses in this process's own thread (no Web Worker in a utility process): it uses the handler it finds here instead of loading
// its worker script, which, bundled, is not a file of its own.
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler };

/** How many bytes are read at a time: pdf.js asks for the parts of the file it needs, never the whole of a 300 MB book at once. */
const CHUNK = 65_536;

/**
 * The file's bytes, a range at a time, as pdf.js asks for them. pdf.js takes an Electron utility process for a browser (its check looks
 * at `process.type`), where a path cannot be opened, so the file is not given to it by name.
 */
class FileRange extends pdfjs.PDFDataRangeTransport {
  constructor(
    private readonly fd: number,
    length: number,
    initialData: Uint8Array,
  ) {
    super(length, initialData);
  }

  requestDataRange(begin: number, end: number): void {
    const chunk = new Uint8Array(end - begin);
    fs.read(this.fd, chunk, 0, chunk.length, begin, (error, read) => {
      // A file that went away mid-read ends the reading: the job's time limit (main/pdfText.ts) stops the process.
      if (!error) this.onDataRange(begin, chunk.subarray(0, read));
    });
  }
}

/** pdf.js's CMaps and standard fonts, read from files (its browser default would fetch them, which a path cannot be). */
class FileData {
  private readonly cMapUrl: string | null;
  private readonly standardFontDataUrl: string | null;

  constructor({ cMapUrl = null, standardFontDataUrl = null }: { cMapUrl?: string | null; standardFontDataUrl?: string | null }) {
    this.cMapUrl = cMapUrl;
    this.standardFontDataUrl = standardFontDataUrl;
  }

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const base = kind === "cMapUrl" ? this.cMapUrl : kind === "standardFontDataUrl" ? this.standardFontDataUrl : null;
    if (!base) throw new Error(`No ${kind} to read ${filename} from.`);
    return new Uint8Array(await fs.promises.readFile(`${base}${filename}`));
  }
}

/**
 * Reads one PDF's text for search (docs/architecture/search.md, "The text of a PDF"), in a utility process of its own: a book takes
 * seconds and holds its parsed pages in memory, which the main process, and with it every window, should not. The file is read a range
 * at a time, not copied whole into memory. A password, for a protected PDF just unlocked in the reader, is used for this reading only.
 */
export async function readJob(job: PdfTextJob): Promise<PdfTextOutcome> {
  let fd: number;
  try {
    fd = fs.openSync(job.path, "r");
  } catch {
    return { status: "unreadable" };
  }
  try {
    const length = fs.fstatSync(fd).size;
    const initial = new Uint8Array(Math.min(length, CHUNK));
    fs.readSync(fd, initial, 0, initial.length, 0);
    return await readPdfText(pdfjs as unknown as PdfjsForText, { range: new FileRange(fd, length, initial) }, {
      cMapUrl: job.cMapUrl,
      standardFontDataUrl: job.standardFontDataUrl,
      ...(job.password === undefined ? {} : { password: job.password }),
      extra: { BinaryDataFactory: FileData, useWorkerFetch: false, rangeChunkSize: CHUNK, disableAutoFetch: true, disableStream: true },
    });
  } catch {
    return { status: "unreadable" };
  } finally {
    fs.closeSync(fd);
  }
}

// A utility process has a parent port to the process that forked it; a test imports `readJob` without one.
process.parentPort?.on("message", (event) => {
  void readJob(event.data as PdfTextJob).then((outcome) => process.parentPort.postMessage(outcome));
});
