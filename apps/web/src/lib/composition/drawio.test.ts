import { describe, expect, it } from "vitest";
import {
  BLANK_DIAGRAM_XML,
  dataUriFromPngBytes,
  drawioEditorUrl,
  drawioOrigin,
  exportMessage,
  hasEmbeddedDiagram,
  loadMessage,
  parseDrawioMessage,
  pngBytesFromDataUri,
} from "./drawio";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's chunks, with a zero CRC: nothing here reads it. */
function png(...chunks: [string, number[] | string][]): Uint8Array {
  const out: number[] = [...SIGNATURE];
  for (const [type, data] of chunks) {
    const bytes = typeof data === "string" ? [...data].map((c) => c.charCodeAt(0)) : data;
    out.push((bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255);
    out.push(...[...type].map((c) => c.charCodeAt(0)), ...bytes, 0, 0, 0, 0);
  }
  return Uint8Array.from(out);
}

const ihdr: [string, number[]] = ["IHDR", new Array(13).fill(0)];

describe("drawioEditorUrl", () => {
  it("opens the offline editor in embed mode, with the JSON protocol", () => {
    const url = new URL(drawioEditorUrl("/drawio/", { dark: false }), "http://localhost");

    expect(url.pathname).toBe("/drawio/index.html");
    for (const [name, value] of [["embed", "1"], ["proto", "json"], ["offline", "1"], ["stealth", "1"], ["pwa", "0"], ["dark", "0"]]) {
      expect(url.searchParams.get(name)).toBe(value);
    }
  });

  it("follows the app's colors", () => {
    expect(new URL(drawioEditorUrl("/drawio/", { dark: true }), "http://localhost").searchParams.get("dark")).toBe("1");
  });

  it("works from another origin's address too", () => {
    expect(drawioEditorUrl("app://drawio/", { dark: false })).toMatch(/^app:\/\/drawio\/index\.html\?/);
  });
});

describe("drawioOrigin", () => {
  it("is the page's own for a path", () => {
    expect(drawioOrigin("/drawio/", "http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("is the address's for an absolute one, custom schemes included", () => {
    expect(drawioOrigin("app://drawio/", "app://composition")).toBe("app://drawio");
    expect(drawioOrigin("https://editor.example.com/drawio/", "http://localhost")).toBe("https://editor.example.com");
  });
});

describe("parseDrawioMessage", () => {
  it("reads the editor's JSON text", () => {
    expect(parseDrawioMessage('{"event":"init"}')).toEqual({ event: "init" });
    expect(parseDrawioMessage('{"event":"export","data":"x"}')).toEqual({ event: "export", data: "x" });
  });

  it("reads an object too", () => {
    expect(parseDrawioMessage({ event: "save", xml: "<x/>" })).toEqual({ event: "save", xml: "<x/>" });
  });

  it.each([["not json"], [""], ["null"], ["[]"], ['{"event":5}'], ['{"noEvent":1}'], [42], [null], [undefined]])("ignores %j", (data) => {
    expect(parseDrawioMessage(data)).toBeNull();
  });
});

describe("messages to the editor", () => {
  it("loads a new diagram from an empty one", () => {
    expect(JSON.parse(loadMessage(null))).toEqual({ action: "load", autosave: 1, xml: BLANK_DIAGRAM_XML });
  });

  it("loads a stored one from its PNG", () => {
    expect(JSON.parse(loadMessage("data:image/png;base64,AAAA"))).toEqual({ action: "load", autosave: 1, xmlpng: "data:image/png;base64,AAAA" });
  });

  it("asks for a PNG with the diagram in it, on white", () => {
    expect(JSON.parse(exportMessage())).toMatchObject({ action: "export", format: "xmlpng", background: "#ffffff" });
  });
});

describe("PNG data addresses", () => {
  it("round-trips bytes, including a big picture", () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => i % 256);

    expect(pngBytesFromDataUri(dataUriFromPngBytes(bytes))).toEqual(bytes);
  });

  it.each([["data:image/jpeg;base64,AAAA"], ["http://example.com/x.png"], ["data:image/png;base64,***"], [5], [null]])("refuses %j", (uri) => {
    expect(pngBytesFromDataUri(uri)).toBeNull();
  });
});

describe("hasEmbeddedDiagram", () => {
  it("finds the mxfile chunk draw.io writes", () => {
    expect(hasEmbeddedDiagram(png(ihdr, ["tEXt", "mxfile\u0000%3Cmxfile%3E"], ["IEND", []]))).toBe(true);
  });

  it("is false for an ordinary picture, or one with other text in it", () => {
    expect(hasEmbeddedDiagram(png(ihdr, ["IEND", []]))).toBe(false);
    expect(hasEmbeddedDiagram(png(ihdr, ["tEXt", "Comment\u0000hello"], ["IEND", []]))).toBe(false);
    expect(hasEmbeddedDiagram(png(ihdr, ["tEXt", "mxfilex\u0000no"], ["IEND", []]))).toBe(false);
  });

  it("is false for anything that is not a PNG, or is cut short", () => {
    expect(hasEmbeddedDiagram(new Uint8Array())).toBe(false);
    expect(hasEmbeddedDiagram(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(false);
    expect(hasEmbeddedDiagram(png(ihdr, ["tEXt", "mxfile\u0000x"]).subarray(0, 30))).toBe(false);
  });

  it("does not look past the end of the picture", () => {
    expect(hasEmbeddedDiagram(png(ihdr, ["IEND", []], ["tEXt", "mxfile\u0000x"]))).toBe(false);
  });
});
