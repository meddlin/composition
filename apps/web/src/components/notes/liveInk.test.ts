// @vitest-environment jsdom
import type { EditorView } from "@codemirror/view";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInkText } from "@/lib/composition/ink";
import { loadInkDrawing } from "@/lib/composition/inkDrawings";
import { InkWidget } from "./liveInk";

vi.mock("@/lib/composition/inkDrawings", () => ({ loadInkDrawing: vi.fn() }));

// jsdom's `import.meta.url` is not a file URL, so the corpus is found by path.
const page = parseInkText(fs.readFileSync(path.join(__dirname, "../../../../../fixtures/conformance/ink/drawing.json"), "utf8"));
const load = vi.mocked(loadInkDrawing);
const requestMeasure = vi.fn();
const view = { requestMeasure } as unknown as EditorView;
const spec = { src: "app_data/sketch-0123456789ab.png", alt: "the sketch", title: "", width: "" };

// Braces: a function a hook returns is run after the test as its teardown, and a mock must not be.
beforeEach(() => {
  load.mockReset();
  requestMeasure.mockReset();
});

/** The microtasks the widget's promise settles in. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("InkWidget", () => {
  it("draws the strokes as an SVG in the page's colours once they are read, and has the editor measure again", async () => {
    load.mockResolvedValue(page);
    const dom = new InkWidget({ ...spec, title: "Monday" }, false).toDOM(view);
    expect(dom.className).toBe("cm-live-image");
    await settled();

    expect(load).toHaveBeenCalledExactlyOnceWith("sketch-0123456789ab.png");
    const svg = dom.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 200 120");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("the sketch");
    expect(svg.querySelector("title")?.textContent).toBe("Monday");
    expect(svg.style.width).toBe("200px");
    expect([...svg.querySelectorAll("path")].map((path) => [path.style.fill, path.getAttribute("fill-opacity")])).toEqual([
      ["var(--foreground)", "1"],
      ["rgb(245, 197, 24)", "0.225"],
      ["rgb(200, 30, 30)", "1"],
      ["var(--brand)", "1"],
    ]);
    expect(requestMeasure).toHaveBeenCalled();
    expect(dom.querySelector("img")).toBeNull();
  });

  it("gives its box the width asked for, which the drawing fills, and ignores one that is not a width", async () => {
    load.mockResolvedValue(page);
    const half = new InkWidget({ ...spec, width: "50%" }, false).toDOM(view);
    const odd = new InkWidget({ ...spec, width: "wide" }, false).toDOM(view);
    await settled();

    expect([half.style.width, half.querySelector("svg")!.style.width]).toEqual(["50%", "100%"]);
    expect([odd.style.width, odd.querySelector("svg")!.style.width]).toEqual(["", "200px"]);
  });

  it("is drawn as the picture when the PNG carries no strokes that can be read", async () => {
    load.mockResolvedValue(null);
    const dom = new InkWidget(spec, false).toDOM(view);
    await settled();

    expect(dom.querySelector("svg")).toBeNull();
    expect(dom.querySelector("img")!.getAttribute("src")).toBe("/app_data/sketch-0123456789ab.png");
    expect(dom.querySelector("img")!.alt).toBe("the sketch");
  });

  it("is drawn as the picture when it can't be fetched, which says the file is gone", async () => {
    load.mockRejectedValue(new Error("404"));
    const dom = new InkWidget(spec, false).toDOM(view);
    await settled();

    dom.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(dom.textContent).toBe("Image not found: the sketch");
  });

  it("leaves a drawing that can't be shown out when it sits beside the text being edited", async () => {
    load.mockRejectedValue(new Error("404"));
    const host = document.createElement("div");
    const dom = new InkWidget(spec, true).toDOM(view);
    host.append(dom);
    await settled();

    dom.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(dom.textContent).toBe("");
  });

  it("is a picture, without fetching strokes, for a drawing from a web address", () => {
    const dom = new InkWidget({ ...spec, src: "https://example.com/d.png" }, false).toDOM(view);

    expect(load).not.toHaveBeenCalled();
    expect(dom.querySelector("img")!.getAttribute("src")).toBe("https://example.com/d.png");
  });

  it("is the same widget for the same drawing, so the editor keeps the drawn one", () => {
    expect(new InkWidget(spec, false).eq(new InkWidget({ ...spec }, false))).toBe(true);
    expect(new InkWidget(spec, false).eq(new InkWidget({ ...spec, width: "10" }, false))).toBe(false);
    expect(new InkWidget(spec, false).eq(new InkWidget(spec, true))).toBe(false);
  });
});
