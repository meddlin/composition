// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pdf.js needs a real browser, so it is replaced by a fake that records how it was asked to open the file and fails the way the
// real one does when a password is needed: what is under test is what openPdf asks of it and how it reads the answer.
const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({
  PDFDataRangeTransport: class {
    constructor(readonly length: number, readonly initialData: Uint8Array) {}
    onDataRange() {}
    abort() {}
  },
  GlobalWorkerOptions: {},
  getDocument,
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({}));

const { openPdf, PdfFileError, PdfPasswordError } = await import("./pdfjs");

const passwordException = (code: number) => Object.assign(new Error("password"), { name: "PasswordException", code });
/** What pdf.js's loading task is: a promise for the document, and a way to give up. */
const task = (promise: Promise<unknown>) => ({ promise, destroy: vi.fn(async () => {}) });

beforeEach(() => {
  getDocument.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(8), { status: 206, headers: { "content-range": "bytes 0-7/1000" } })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("openPdf", () => {
  it("gives the password it was handed to pdf.js, and nothing else of it", async () => {
    getDocument.mockReturnValue(task(Promise.resolve({ numPages: 1 })));

    const opened = await openPdf(7, "s3cret");

    expect(getDocument.mock.calls[0][0].password).toBe("s3cret");
    expect(opened.doc).toEqual({ numPages: 1 });
  });

  it("asks pdf.js for no password when it has none, so a file that needs one says so", async () => {
    getDocument.mockReturnValue(task(Promise.resolve({})));

    await openPdf(7);

    expect("password" in getDocument.mock.calls[0][0]).toBe(false);
  });

  it("says a password is needed when pdf.js asks for one, and that it is not right when pdf.js says so", async () => {
    getDocument.mockReturnValueOnce(task(Promise.reject(passwordException(1)))).mockReturnValueOnce(task(Promise.reject(passwordException(2))));

    await expect(openPdf(7)).rejects.toMatchObject({ incorrect: false, message: "This PDF is protected by a password." });
    await expect(openPdf(7, "nope")).rejects.toMatchObject({ incorrect: true, message: "The password is not right." });
  });

  it("never puts the password into an error's words", async () => {
    getDocument.mockReturnValue(task(Promise.reject(passwordException(2))));

    const error = await openPdf(7, "s3cret-word").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PdfPasswordError);
    expect((error as Error).message).not.toContain("s3cret-word");
  });

  it("lets go of the loading task when it fails", async () => {
    const failing = task(Promise.reject(passwordException(1)));
    getDocument.mockReturnValue(failing);

    await openPdf(7).catch(() => {});

    expect(failing.destroy).toHaveBeenCalled();
  });

  it("still reports a file that is not a PDF, or cannot be opened, in its own words", async () => {
    getDocument.mockReturnValueOnce(task(Promise.reject(Object.assign(new Error("x"), { name: "InvalidPDFException" })))).mockReturnValueOnce(task(Promise.reject(new Error("boom"))));

    await expect(openPdf(7)).rejects.toThrow(new PdfFileError("This file is not a PDF Composition can read."));
    await expect(openPdf(7)).rejects.toThrow("The PDF could not be opened.");
  });
});
