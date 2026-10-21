import { describe, expect, it } from "vitest";
import type { ImageInfo } from "@/lib/composition/api";
import { formatSize, matchImages, MAX_PICKER_IMAGES, usageLabel } from "./imagePicker";

const image = (name: string, usedIn = 0): ImageInfo => ({
  name,
  size: 1,
  modifiedAt: "2026-01-01T00:00:00.000Z",
  usedIn: Array.from({ length: usedIn }, (_, id) => ({ id, title: "n" })),
});

const images = [
  image("trip-plan-route-map-111111111111.png"),
  image("groceries-image-222222222222.jpg"),
  image("trip-plan-image-333333333333.png"),
];

describe("matchImages", () => {
  it("lists everything, in the order given, for no query", () => {
    expect(matchImages(images, "").map((i) => i.name)).toEqual(images.map((i) => i.name));
    expect(matchImages(images, "  ").length).toBe(3);
  });

  it("keeps the images whose name has every word, ignoring case", () => {
    expect(matchImages(images, "TRIP").map((i) => i.name)).toEqual([images[0].name, images[2].name]);
    expect(matchImages(images, "trip map").map((i) => i.name)).toEqual([images[0].name]);
    expect(matchImages(images, "map trip").map((i) => i.name)).toEqual([images[0].name]);
  });

  it("is empty when nothing matches", () => {
    expect(matchImages(images, "zzz")).toEqual([]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: MAX_PICKER_IMAGES + 5 }, (_, i) => image(`a${i}.png`));
    expect(matchImages(many, "")).toHaveLength(MAX_PICKER_IMAGES);
    expect(matchImages(many, "", Infinity)).toHaveLength(MAX_PICKER_IMAGES + 5);
  });
});

describe("usageLabel", () => {
  it("says how many notes use the image", () => {
    expect(usageLabel(image("a.png", 0))).toBe("Not used in any note");
    expect(usageLabel(image("a.png", 1))).toBe("Used in 1 note");
    expect(usageLabel(image("a.png", 4))).toBe("Used in 4 notes");
  });
});

describe("formatSize", () => {
  it("picks a unit a person would", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
