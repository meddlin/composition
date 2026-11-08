import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { documentIdFromPath, servePdf } from "./rangeResponse";

let dir: string;
let file: string;
const bytes = Buffer.from("0123456789abcdefghij"); // 20 bytes

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-range-"));
  file = path.join(dir, "book.pdf");
  fs.writeFileSync(file, bytes);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const text = async (response: Response) => Buffer.from(await response.arrayBuffer()).toString();

describe("servePdf", () => {
  it("sends the whole file when no range is asked for, and says ranges are understood", async () => {
    const response = servePdf(file, null, "GET");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("20");
    expect(await text(response)).toBe("0123456789abcdefghij");
  });

  it("sends only the bytes of a range, with where they are in the file", async () => {
    const response = servePdf(file, "bytes=5-9", "GET");

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(response.headers.get("content-length")).toBe("5");
    expect(await text(response)).toBe("56789");
  });

  it("reads from a point to the end, and the last bytes of the file", async () => {
    expect(await text(servePdf(file, "bytes=15-", "GET"))).toBe("fghij");
    const tail = servePdf(file, "bytes=-4", "GET");
    expect(tail.headers.get("content-range")).toBe("bytes 16-19/20");
    expect(await text(tail)).toBe("ghij");
  });

  it("stops at the end of the file when a range goes past it", async () => {
    const response = servePdf(file, "bytes=18-100", "GET");

    expect(response.headers.get("content-range")).toBe("bytes 18-19/20");
    expect(await text(response)).toBe("ij");
  });

  it("refuses a range that starts past the end, or that is not one", async () => {
    for (const header of ["bytes=20-30", "bytes=9-3", "bytes=-", "items=0-1", "bytes=0-1,4-5", "bytes=a-b"]) {
      const response = servePdf(file, header, "GET");
      expect(response.status, header).toBe(416);
      expect(response.headers.get("content-range"), header).toBe("bytes */20");
    }
  });

  it("answers a HEAD with the headers and no body", async () => {
    const response = servePdf(file, "bytes=0-4", "HEAD");

    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("5");
    expect(await text(response)).toBe("");
  });

  it("does not keep a copy of the bytes anywhere", () => {
    expect(servePdf(file, null, "GET").headers.get("cache-control")).toBe("no-store");
  });

  it("is a 404 for a file that is gone or is a folder", () => {
    expect(servePdf(path.join(dir, "missing.pdf"), null, "GET").status).toBe(404);
    expect(servePdf(dir, null, "GET").status).toBe(404);
  });

  it("serves an empty file whole and refuses any range of it", async () => {
    const empty = path.join(dir, "empty.pdf");
    fs.writeFileSync(empty, "");

    expect((servePdf(empty, null, "GET")).status).toBe(200);
    expect(servePdf(empty, "bytes=0-1", "GET").status).toBe(416);
  });

  it("streams a slice of a large file without reading the rest", async () => {
    const big = path.join(dir, "big.pdf");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 3_000_000_000); // sparse: no real disk is used

    const response = servePdf(big, "bytes=2999999990-2999999999", "GET");

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2999999990-2999999999/3000000000");
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });
});

describe("documentIdFromPath", () => {
  it("reads the id of /documents/<id>, and nothing else", () => {
    expect(documentIdFromPath("/documents/42")).toBe(42);
    for (const bad of ["/documents/", "/documents/abc", "/documents/-1", "/documents/4/2", "/documents/42/", "/documents/../etc", "/app_data/42", "/documents/1234567890123456"]) {
      expect(documentIdFromPath(bad), bad).toBeNull();
    }
  });
});
