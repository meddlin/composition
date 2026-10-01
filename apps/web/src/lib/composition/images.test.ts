import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imageDir, imageFileName, readImage, sniffImage, storeImage } from "./images";
import { MAX_IMAGE_BYTES } from "./imageRefs";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const GIF = Uint8Array.from([..."GIF89a"].map((c) => c.charCodeAt(0)).concat([1, 2]));
const WEBP = Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0))));

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-images-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sniffImage", () => {
  it("recognises the supported formats by their bytes", () => {
    expect(sniffImage(PNG)).toBe("png");
    expect(sniffImage(JPEG)).toBe("jpg");
    expect(sniffImage(GIF)).toBe("gif");
    expect(sniffImage(WEBP)).toBe("webp");
  });

  it("rejects anything else, including SVG and short input", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("hello"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("imageFileName", () => {
  it("combines the note title, the image's own name, and a content hash", () => {
    const name = imageFileName("Trip Plan", "Route Map.JPG", PNG, "png");
    expect(name).toMatch(/^trip-plan-route-map-[0-9a-f]{12}\.png$/);
  });

  it("is stable for the same inputs and differs when the bytes differ", () => {
    expect(imageFileName("A", "b.png", PNG, "png")).toBe(imageFileName("A", "b.png", PNG, "png"));
    expect(imageFileName("A", "b.png", PNG, "png")).not.toBe(imageFileName("A", "b.png", Uint8Array.from([...PNG, 9]), "png"));
  });

  it("differs between notes that share an image name", () => {
    expect(imageFileName("One", "image.png", PNG, "png")).not.toBe(imageFileName("Two", "image.png", PNG, "png"));
  });

  it("falls back when a name has nothing usable and never lets it escape the folder", () => {
    expect(imageFileName("日本語", "../../etc/passwd", PNG, "png")).toMatch(/^note-passwd-[0-9a-f]{12}\.png$/);
    expect(imageFileName("???", "", PNG, "png")).toMatch(/^note-image-[0-9a-f]{12}\.png$/);
  });

  it("keeps long names bounded", () => {
    expect(imageFileName("x".repeat(500), "y".repeat(500), PNG, "png").length).toBeLessThan(110);
  });
});

describe("storeImage", () => {
  it("writes the bytes into app_data under the application data directory", () => {
    const result = storeImage(dir, { noteTitle: "Trip", fileName: "map.png", data: PNG });

    expect(result.name).toMatch(/^trip-map-[0-9a-f]{12}\.png$/);
    expect(fs.readFileSync(path.join(dir, "app_data", result.name!))).toEqual(Buffer.from(PNG));
    expect(imageDir(dir)).toBe(path.join(dir, "app_data"));
  });

  it("reuses the file when the same image is stored again for the same note", () => {
    const first = storeImage(dir, { noteTitle: "Trip", fileName: "map.png", data: PNG });
    const second = storeImage(dir, { noteTitle: "Trip", fileName: "map.png", data: PNG });

    expect(second.name).toBe(first.name);
    expect(fs.readdirSync(path.join(dir, "app_data"))).toEqual([first.name]);
  });

  it("gives different images distinct names even when the note and file name match", () => {
    const a = storeImage(dir, { noteTitle: "Trip", fileName: "image.png", data: PNG });
    const b = storeImage(dir, { noteTitle: "Trip", fileName: "image.png", data: Uint8Array.from([...PNG, 7]) });

    expect(a.name).not.toBe(b.name);
  });

  it("names the file by what it is, not by the extension it was given", () => {
    const result = storeImage(dir, { noteTitle: "Trip", fileName: "photo.exe", data: JPEG });
    expect(result.name).toMatch(/\.jpg$/);
  });

  it("accepts an image over the limit when the limit is lifted", () => {
    const data = new Uint8Array(MAX_IMAGE_BYTES + 1);
    data.set(JPEG);

    expect(storeImage(dir, { noteTitle: "Trip", fileName: "x.png", data }, null).name).toMatch(/\.jpg$/);
  });

  it.each([
    ["an empty file", new Uint8Array()],
    ["something that isn't an image", new TextEncoder().encode("not an image")],
    ["an image that's too large", new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff, 0, 3)],
  ])("refuses %s without writing anything", (_what, data) => {
    const result = storeImage(dir, { noteTitle: "Trip", fileName: "x.png", data });

    expect(result.error).toBeTruthy();
    expect(result.name).toBeUndefined();
    expect(fs.existsSync(path.join(dir, "app_data"))).toBe(false);
  });

  it("reports a directory it cannot create as an error", () => {
    const blocker = path.join(dir, "file");
    fs.writeFileSync(blocker, "");

    const result = storeImage(blocker, { noteTitle: "Trip", fileName: "x.png", data: PNG });

    expect(result.error).toMatch(/Could not save the image/);
  });
});

describe("readImage", () => {
  it("returns a stored image with its content type", async () => {
    const { name } = storeImage(dir, { noteTitle: "Trip", fileName: "map.png", data: PNG });

    const image = await readImage(dir, name!);

    expect(image?.contentType).toBe("image/png");
    expect(new Uint8Array(image!.data)).toEqual(PNG);
  });

  it("serves a hand-placed .jpeg file as image/jpeg", async () => {
    fs.mkdirSync(path.join(dir, "app_data"));
    fs.writeFileSync(path.join(dir, "app_data", "mine.JPEG"), JPEG);

    expect((await readImage(dir, "mine.JPEG"))?.contentType).toBe("image/jpeg");
  });

  it("returns null for a missing file", async () => {
    expect(await readImage(dir, "nope.png")).toBeNull();
  });

  it.each(["../composition.db", "..%2Fx.png", "a/b.png", "x.png/../y.png", "notes.txt", ".hidden.png", ""])(
    "returns null for the unsafe name %j without touching the disk",
    async (name) => {
      fs.writeFileSync(path.join(dir, "composition.db"), "secret");
      expect(await readImage(dir, name)).toBeNull();
    },
  );
});
