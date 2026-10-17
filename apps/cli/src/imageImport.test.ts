import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imagePathsIn, importImages } from "./imageImport";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-img-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = (name: string, content = "x") => {
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
};

describe("imagePathsIn", () => {
  it("returns the paths when every one is an existing image file", () => {
    const a = file("a.png");
    const b = file("my pic.JPG");
    expect(imagePathsIn(`${a} '${b}'`, dir)).toEqual([a, b]);
  });

  it("takes a path with unquoted spaces whole", () => {
    const pic = file("my holiday pic.webp");
    expect(imagePathsIn(pic, dir)).toEqual([pic]);
  });

  it("is null for ordinary text, a missing file, a non-image or a mix", () => {
    const text = file("notes.txt");
    const pic = file("a.gif");
    expect(imagePathsIn("just some words", dir)).toBeNull();
    expect(imagePathsIn(path.join(dir, "missing.png"), dir)).toBeNull();
    expect(imagePathsIn(text, dir)).toBeNull();
    expect(imagePathsIn(`${pic} ${text}`, dir)).toBeNull();
    expect(imagePathsIn("", dir)).toBeNull();
  });

  it("is null for a folder named like an image", () => {
    fs.mkdirSync(path.join(dir, "weird.png"));
    expect(imagePathsIn(path.join(dir, "weird.png"), dir)).toBeNull();
  });
});

describe("importImages", () => {
  it("stores each file and returns one Markdown line per image", async () => {
    const saved: { noteId: number; fileName: string; size: number }[] = [];
    const api = {
      saveImage: async ({ noteId, fileName, data }: { noteId: number; fileName: string; data: Uint8Array }) => {
        saved.push({ noteId, fileName, size: data.byteLength });
        return { name: `plan-${fileName.toLowerCase()}` };
      },
    };

    const result = await importImages(api, 7, [file("Map.png", "12345"), file("[odd] name.jpg", "1")]);

    expect(saved).toEqual([
      { noteId: 7, fileName: "Map.png", size: 5 },
      { noteId: 7, fileName: "[odd] name.jpg", size: 1 },
    ]);
    expect(result.markdown).toBe("![Map](app_data/plan-map.png)\n![odd  name](app_data/plan-[odd] name.jpg)");
    expect(result.errors).toEqual([]);
  });

  it("names the images that were refused and still adds the rest", async () => {
    const api = {
      saveImage: async ({ fileName }: { fileName: string }) =>
        fileName === "bad.png" ? { error: "Only PNG, JPEG, GIF, and WebP images are supported." } : { name: "ok-hash.png" },
    };

    const result = await importImages(api, 1, [file("bad.png"), file("good.png")]);

    expect(result.markdown).toBe("![good](app_data/ok-hash.png)");
    expect(result.errors).toEqual(["bad.png: Only PNG, JPEG, GIF, and WebP images are supported."]);
  });
});
