import fs from "node:fs";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { conformancePath } from "./__fixtures__/conformance";
import { InkError, parseInkText } from "./ink";
import { crc32, pixelsPerPoint, readInkChunk, readInkPng } from "./inkPng";

const sample = new Uint8Array(fs.readFileSync(conformancePath("ink/sample.png")));
const drawingText = fs.readFileSync(conformancePath("ink/drawing.json"));

type RawChunk = { type: string; data: Uint8Array };

/** The chunks of a well-formed PNG, with their types and data (no CRCs: `assemble` writes them). */
function split(png: Uint8Array): RawChunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: RawChunk[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = view.getUint32(offset);
    chunks.push({ type: String.fromCharCode(...png.subarray(offset + 4, offset + 8)), data: png.slice(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

function assemble(chunks: RawChunk[], options: { badCrcOf?: string } = {}): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const be = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  for (const { type, data } of chunks) {
    const body = Uint8Array.from([...Buffer.from(type, "latin1"), ...data]);
    const crc = crc32(body) ^ (options.badCrcOf === type ? 1 : 0);
    parts.push(...be(data.length), ...body, ...be(crc));
  }
  return Uint8Array.from(parts);
}

/** `sample.png` with its stroke chunk made from `data`. */
const withInkChunk = (data: Uint8Array, options?: { badCrcOf?: string }) =>
  assemble(
    split(sample).map((chunk) => (chunk.type === "inKJ" ? { type: "inKJ", data } : chunk)),
    options,
  );

/** The data of a well-formed stroke chunk: version byte, the length of the text, the text as a zlib stream. */
function inkChunkData(text: Uint8Array, options: { version?: number; size?: number; stream?: Uint8Array } = {}): Uint8Array {
  const size = options.size ?? text.length;
  return Uint8Array.from([
    options.version ?? 1,
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...(options.stream ?? zlib.deflateSync(text)),
  ]);
}

describe("crc32", () => {
  it("is the CRC PNG chunks use", () => {
    expect(crc32(Buffer.from("IEND"))).toBe(0xae426082);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("the container corpus", () => {
  type Case = { file: string; name: string; width: number; problems: string[]; pixelsPerPoint: number };
  const { cases } = JSON.parse(fs.readFileSync(conformancePath("ink/containers.json"), "utf8")) as { cases: Case[] };

  it("has the cases the Swift side counts on", () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  for (const entry of cases) {
    it(entry.name, async () => {
      const png = new Uint8Array(fs.readFileSync(conformancePath(`ink/${entry.file}`)));
      const { drawing, problems } = await readInkPng(png);
      expect(problems).toEqual(entry.problems);
      expect(drawing?.width).toBe(entry.width);
      expect(pixelsPerPoint(png)).toBe(entry.pixelsPerPoint);
    });
  }
});

describe("pixelsPerPoint", () => {
  /** `sample.png` with a pHYs chunk of these pixels to a metre (or none), put before the pixels as a writer does. */
  const withPhys = (physics?: { x: number; y: number; unit: number }) => {
    const chunks = split(sample).filter((chunk) => chunk.type !== "pHYs");
    if (physics) {
      const be = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
      chunks.splice(1, 0, { type: "pHYs", data: Uint8Array.from([...be(physics.x), ...be(physics.y), physics.unit]) });
    }
    return assemble(chunks);
  };

  it("is two when the PNG says nothing, or says it in a way that is no use", () => {
    expect(pixelsPerPoint(withPhys())).toBe(2);
    expect(pixelsPerPoint(withPhys({ x: 5669, y: 5669, unit: 0 }))).toBe(2);
    expect(pixelsPerPoint(withPhys({ x: 5669, y: 2835, unit: 1 }))).toBe(2);
    expect(pixelsPerPoint(withPhys({ x: 0, y: 0, unit: 1 }))).toBe(2);
    expect(pixelsPerPoint(new Uint8Array(40))).toBe(2);
  });

  it("is the density a PNG states, to a hundredth: 72 dots to an inch is one to a point", () => {
    expect(pixelsPerPoint(withPhys({ x: 2835, y: 2835, unit: 1 }))).toBe(1);
    expect(pixelsPerPoint(withPhys({ x: 5669, y: 5669, unit: 1 }))).toBe(2);
    expect(pixelsPerPoint(withPhys({ x: 4645, y: 4645, unit: 1 }))).toBe(1.64);
  });
});

describe("the committed sample.png", () => {
  it("carries drawing.json in its inKJ chunk, byte for byte", async () => {
    const { json, problems } = await readInkChunk(sample);
    expect(problems).toEqual([]);
    expect(Buffer.from(json!).equals(drawingText)).toBe(true);
  });

  it("reads as the drawing", async () => {
    const { drawing, problems } = await readInkPng(sample);
    expect(problems).toEqual([]);
    expect(drawing).toEqual(parseInkText(drawingText.toString("utf8")));
    expect(drawing?.strokes).toHaveLength(4);
  });

  it("is a picture to everything else: its pixels are an ordinary PNG with the chunk among the others", () => {
    const types = split(sample).map((chunk) => chunk.type);
    expect(types[0]).toBe("IHDR");
    expect(types.at(-1)).toBe("IEND");
    expect(types).toContain("IDAT");
    expect(types.indexOf("inKJ")).toBeGreaterThan(0);
    expect(types.indexOf("inKJ")).toBeLessThan(types.length - 1);
  });
});

describe("two stroke chunks", () => {
  /** `sample.png` with one more chunk after the one it has, just before IEND. */
  const withAnother = (data: Uint8Array) => {
    const chunks = split(sample);
    return assemble([...chunks.slice(0, -1), { type: "inKJ", data }, chunks.at(-1)!]);
  };
  const other = Buffer.from(drawingText.toString("utf8").replace('"width":200', '"width":201'));

  it("is read as the last one that reads", async () => {
    const result = await readInkPng(withAnother(inkChunkData(other)));
    expect(result.problems).toEqual([]);
    expect(result.drawing?.width).toBe(201);
  });

  it("keeps the first when the second is damaged, and says the second is", async () => {
    const result = await readInkPng(withAnother(inkChunkData(other, { version: 2 })));
    expect(result.drawing?.width).toBe(200);
    expect(result.problems).toEqual(["The inKJ chunk is from a newer version."]);
  });
});

describe("a PNG that is only a picture", () => {
  it("has no drawing and no problem", async () => {
    const plain = assemble(split(sample).filter((chunk) => chunk.type !== "inKJ" && chunk.type !== "inKP"));
    expect(await readInkPng(plain)).toEqual({ drawing: null, problems: [] });
  });

  it("is refused when it is not a PNG, or is cut short", async () => {
    await expect(readInkPng(new Uint8Array(40))).rejects.toThrow(InkError);
    await expect(readInkPng(sample.slice(0, sample.length - 20))).rejects.toThrow("cut short");
    await expect(readInkPng(sample.slice(0, 33))).rejects.toThrow(InkError);
  });
});

describe("a chunk that cannot be used shows the PNG as a picture", () => {
  it("with a bad CRC", async () => {
    const { json, problems } = await readInkChunk(withInkChunk(inkChunkData(drawingText), { badCrcOf: "inKJ" }));
    expect(json).toBeNull();
    expect(problems).toEqual(["The inKJ chunk is damaged."]);
  });

  it("of a newer version, though its CRC is right", async () => {
    const result = await readInkPng(withInkChunk(inkChunkData(drawingText, { version: 2 })));
    expect(result.drawing).toBeNull();
    expect(result.problems).toEqual(["The inKJ chunk is from a newer version."]);
  });

  it("that is too short to hold a length", async () => {
    expect((await readInkChunk(withInkChunk(Uint8Array.from([1, 0, 0])))).problems).toEqual(["The inKJ chunk is short."]);
  });

  it("whose stream is not zlib", async () => {
    const result = await readInkChunk(withInkChunk(inkChunkData(drawingText, { stream: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) })));
    expect(result).toEqual({ json: null, problems: ["The inKJ chunk does not unpack."] });
  });

  it("whose stream is cut short", async () => {
    const stream = zlib.deflateSync(drawingText);
    const result = await readInkChunk(withInkChunk(inkChunkData(drawingText, { stream: stream.subarray(0, stream.length - 12) })));
    expect(result.json).toBeNull();
    expect(result.problems).toEqual(["The inKJ chunk does not unpack."]);
  });

  it("that unpacks to other than the length it says, either way", async () => {
    for (const size of [drawingText.length - 1, drawingText.length + 1]) {
      const result = await readInkChunk(withInkChunk(inkChunkData(drawingText, { size })));
      expect(result.problems).toEqual(["The inKJ chunk does not unpack."]);
    }
  });

  it("that says it is bigger than any drawing may be", async () => {
    const result = await readInkChunk(withInkChunk(inkChunkData(drawingText, { size: 0xffffffff })));
    expect(result.problems).toEqual(["The inKJ chunk does not unpack."]);
  });

  it("that holds JSON of a newer drawing, or not a drawing", async () => {
    const newer = Buffer.from(drawingText.toString("utf8").replace('"version":1', '"version":2'));
    const newerResult = await readInkPng(withInkChunk(inkChunkData(newer)));
    expect(newerResult.drawing).toBeNull();
    expect(newerResult.problems).toEqual(["This drawing was made by a newer version of Composition."]);

    const garbage = await readInkPng(withInkChunk(inkChunkData(Buffer.from("not json at all"))));
    expect(garbage.drawing).toBeNull();
    expect(garbage.problems).toEqual(["This drawing's JSON is damaged."]);
  });

  it("that is not UTF-8", async () => {
    const result = await readInkPng(withInkChunk(inkChunkData(Uint8Array.from([0xff, 0xfe, 0x7b]))));
    expect(result.drawing).toBeNull();
    expect(result.problems).toEqual(["This drawing's text is not UTF-8."]);
  });
});
