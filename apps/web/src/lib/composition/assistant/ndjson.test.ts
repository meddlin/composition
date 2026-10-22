import { describe, expect, it } from "vitest";
import { NdjsonError, readNdjson } from "./ndjson";

const encoder = new TextEncoder();

/** A body that delivers exactly these pieces, in this order, the way a network might. */
function bodyOf(...pieces: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(typeof piece === "string" ? encoder.encode(piece) : piece);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of readNdjson(body)) values.push(value);
  return values;
}

describe("readNdjson", () => {
  it("yields one value per line", async () => {
    expect(await collect(bodyOf('{"a":1}\n{"b":2}\n'))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("joins a line that arrives in pieces", async () => {
    expect(await collect(bodyOf('{"a":', '1}\n{"b"', ":2}\n"))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("keeps a multi-byte character whole when its bytes arrive in different chunks", async () => {
    const bytes = encoder.encode('{"t":"héllo 😀"}\n');
    // Cut inside the two-byte é and again inside the four-byte emoji.
    const e = bytes.indexOf(0xc3) + 1;
    const emoji = bytes.indexOf(0xf0) + 2;
    expect(await collect(bodyOf(bytes.slice(0, e), bytes.slice(e, emoji), bytes.slice(emoji)))).toEqual([
      { t: "héllo 😀" },
    ]);
  });

  it("yields a last line that has no newline after it", async () => {
    expect(await collect(bodyOf('{"a":1}\n{"b":2}'))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("skips blank lines and accepts CRLF line endings", async () => {
    expect(await collect(bodyOf('{"a":1}\r\n\r\n\n{"b":2}\r\n\r\n'))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("delivers the lines before a line that is not JSON, then fails with NdjsonError naming it", async () => {
    const seen: unknown[] = [];
    const read = async () => {
      for await (const value of readNdjson(bodyOf('{"a":1}\n<html>502 Bad Gateway</html>\n{"b":2}\n'))) seen.push(value);
    };
    await expect(read()).rejects.toThrow(NdjsonError);
    await expect(read()).rejects.toThrow("<html>502 Bad Gateway</html>");
    expect(seen).toEqual([{ a: 1 }, { a: 1 }]);
  });
});
