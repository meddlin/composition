import { describe, expect, it } from "vitest";
import { findImageRefs, imageAlt, imageMarkdown, imageNameFromRef, imageRef, isImageName } from "./imageRefs";

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

describe("findImageRefs", () => {
  it("finds Markdown images and <Image> tags, once each", () => {
    const content = [
      "![a](app_data/one-111111111111.png) and ![again](app_data/one-111111111111.png)",
      '<Image src="app_data/two-222222222222.jpg" alt="" />',
      "![c](./app_data/three-333333333333.webp)",
    ].join("\n");

    expect(findImageRefs(content)).toEqual(
      new Set(["one-111111111111.png", "two-222222222222.jpg", "three-333333333333.webp"]),
    );
  });

  it("finds a bare path, including one that ends a sentence", () => {
    expect(findImageRefs("It was app_data/map-111111111111.png.")).toEqual(new Set(["map-111111111111.png"]));
  });

  it("ignores everything that is not a stored image", () => {
    const content = [
      "![x](https://example.com/app_data/a.png)",
      "![x](/app_data/b.png)",
      "![x](app_data/notes.txt)",
      "![x](app_data/sub/c.png)",
      "![x](other/app_data/d.png)",
      "app_data/",
    ].join("\n");

    expect(findImageRefs(content)).toEqual(new Set());
  });
});

describe("imageAlt", () => {
  it("turns the file name into words, without the content hash", () => {
    expect(imageAlt("trip-plan-route-map-3f9c2a71b0de.png")).toBe("trip plan route map");
  });

  it("copes with a name that has no hash, or nothing else", () => {
    expect(imageAlt("My_photo.v2.JPG")).toBe("My photo v2");
    expect(imageAlt("3f9c2a71b0de.png")).toBe("3f9c2a71b0de");
    expect(imageAlt("-3f9c2a71b0de.png")).toBe("image");
  });
});

describe("imageMarkdown", () => {
  it("is the same Markdown a paste inserts, with words from the file name as the alt text", () => {
    expect(imageMarkdown("trip-map-3f9c2a71b0de.png")).toBe("![trip map](app_data/trip-map-3f9c2a71b0de.png)");
  });

  it("uses the given alt text, with brackets and line breaks taken out", () => {
    expect(imageMarkdown("a-3f9c2a71b0de.png", "the [big]\nmap")).toBe("![the big map](app_data/a-3f9c2a71b0de.png)");
    expect(imageMarkdown("a-3f9c2a71b0de.png", "  ")).toBe("![a](app_data/a-3f9c2a71b0de.png)");
  });

  it("round-trips through findImageRefs", () => {
    expect([...findImageRefs(imageMarkdown("a-3f9c2a71b0de.png"))]).toEqual(["a-3f9c2a71b0de.png"]);
  });
});
