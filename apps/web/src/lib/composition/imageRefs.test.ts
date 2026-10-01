import { describe, expect, it } from "vitest";
import { imageNameFromRef, imageRef, isImageName } from "./imageRefs";

describe("imageRef / imageNameFromRef", () => {
  it("round-trips a stored image's name", () => {
    expect(imageRef("trip-map-3f9c2a71b0de.png")).toBe("app_data/trip-map-3f9c2a71b0de.png");
    expect(imageNameFromRef(imageRef("trip-map-3f9c2a71b0de.png"))).toBe("trip-map-3f9c2a71b0de.png");
  });

  it("accepts a leading ./", () => {
    expect(imageNameFromRef("./app_data/a.webp")).toBe("a.webp");
  });

  it.each([
    "https://example.com/app_data/a.png",
    "/app_data/a.png",
    "other/a.png",
    "app_data/",
    "app_data/a.txt",
    "app_data/../secret.png",
    "app_data/sub/a.png",
    "app_data/a.svg",
    "app_data/.hidden.png",
    "",
  ])("does not treat %j as a stored image", (src) => {
    expect(imageNameFromRef(src)).toBeNull();
  });
});

describe("isImageName", () => {
  it("is a single path segment with an image extension", () => {
    expect(isImageName("a.PNG")).toBe(true);
    expect(isImageName("a.jpeg")).toBe(true);
    expect(isImageName("a/b.png")).toBe(false);
    expect(isImageName("a\\b.png")).toBe(false);
    expect(isImageName("a.png.exe")).toBe(false);
  });
});
