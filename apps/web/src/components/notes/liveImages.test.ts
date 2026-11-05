// @vitest-environment jsdom
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { ImageWidget } from "./liveImages";

const view = { requestMeasure: vi.fn() } as unknown as EditorView;
const spec = { src: "app_data/map-0123456789ab.png", alt: "the map", title: "", width: "" };

describe("ImageWidget", () => {
  it("fetches a stored image from where this build serves them, and any other source as written", () => {
    expect(new ImageWidget(spec, false).toDOM(view).querySelector("img")!.getAttribute("src")).toBe("/app_data/map-0123456789ab.png");
    const web = new ImageWidget({ ...spec, src: "https://example.com/p.png" }, false).toDOM(view);
    expect(web.querySelector("img")!.getAttribute("src")).toBe("https://example.com/p.png");
  });

  it("draws at the width asked for, and carries the alt text and title", () => {
    const image = new ImageWidget({ ...spec, width: "50%", title: "Hover" }, false).toDOM(view).querySelector("img")!;
    expect(image.style.width).toBe("50%");
    expect(image.alt).toBe("the map");
    expect(image.title).toBe("Hover");
  });

  it("ignores a width that is not one", () => {
    expect(new ImageWidget({ ...spec, width: "wide" }, false).toDOM(view).querySelector("img")!.style.width).toBe("");
  });

  it("says the file is missing, in its place, when it can't be loaded", () => {
    const dom = new ImageWidget(spec, false).toDOM(view);
    dom.querySelector("img")!.dispatchEvent(new Event("error"));

    expect(dom.querySelector("img")).toBeNull();
    expect(dom.textContent).toBe("Image not found: the map");
  });

  it("leaves out a picture that can't be loaded when it sits beside the text being edited", () => {
    const host = document.createElement("div");
    const dom = new ImageWidget(spec, true).toDOM(view);
    host.append(dom);
    dom.querySelector("img")!.dispatchEvent(new Event("error"));

    expect(host.children).toHaveLength(0);
  });

  it("is the same widget for the same picture, so the editor keeps the loaded one", () => {
    expect(new ImageWidget(spec, false).eq(new ImageWidget({ ...spec }, false))).toBe(true);
    expect(new ImageWidget(spec, false).eq(new ImageWidget({ ...spec, width: "10" }, false))).toBe(false);
    expect(new ImageWidget(spec, false).eq(new ImageWidget(spec, true))).toBe(false);
  });
});
