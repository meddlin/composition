// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInkText, type InkDrawing } from "@/lib/composition/ink";
import { loadInkDensity, loadInkDrawing } from "@/lib/composition/inkDrawings";
import { Ink } from "./Ink";

vi.mock("@/lib/composition/inkDrawings", () => ({ loadInkDrawing: vi.fn(), loadInkDensity: vi.fn(() => Promise.resolve(2)) }));

// jsdom's `import.meta.url` is not a file URL, so the corpus is found by path, as markContrast.test.ts finds the stylesheet.
const page = parseInkText(fs.readFileSync(path.join(__dirname, "../../../../../../fixtures/conformance/ink/drawing.json"), "utf8"));
const load = vi.mocked(loadInkDrawing);
const density = vi.mocked(loadInkDensity);

// Braces: a function a hook returns is run after the test as its teardown, and the mock must not be.
beforeEach(() => {
  load.mockReset();
  density.mockReset().mockResolvedValue(2);
});
afterEach(cleanup);

const stored = "app_data/sketch-0123456789ab.png";

describe("Ink", () => {
  it("draws the drawing's strokes as an SVG, in the scheme's colours, once they are read", async () => {
    load.mockResolvedValue(page);
    render(<Ink src={stored} alt="A sketch" />);

    expect(screen.getByText("Drawing…")).toBeTruthy();
    const drawing = await screen.findByRole("img", { name: "A sketch" });
    expect(load).toHaveBeenCalledExactlyOnceWith("sketch-0123456789ab.png");

    expect(drawing.tagName.toLowerCase()).toBe("svg");
    expect(drawing.getAttribute("viewBox")).toBe("0 0 200 120");
    // As big as its canvas, never wider than the note.
    expect((drawing as unknown as SVGElement).style.width).toBe("200px");
    const paths = [...drawing.querySelectorAll("path")];
    expect(paths.map((path) => [path.style.fill, path.getAttribute("fill-opacity")])).toEqual([
      ["var(--foreground)", "1"],
      ["rgb(245, 197, 24)", "0.225"],
      ["light-dark(rgb(200, 30, 30), rgb(225, 55, 55))", "1"],
      ["var(--brand)", "1"],
    ]);
    expect(paths.every((path) => (path.getAttribute("d") ?? "").length > 20)).toBe(true);
  });

  it("is not an image the browser fetches: the drawing comes from the PNG's strokes, not its pixels", async () => {
    load.mockResolvedValue(page);
    const { container } = render(<Ink src={stored} alt="A sketch" />);
    await screen.findByRole("img", { name: "A sketch" });
    expect(container.querySelector("img")).toBeNull();
  });

  it("takes a width as <Image> does: the box has it and the drawing fills the box", async () => {
    load.mockResolvedValue(page);
    const { container } = render(<Ink src={stored} alt="A sketch" width="80%" />);
    const drawing = await screen.findByRole("img", { name: "A sketch" });

    expect((container.firstElementChild as HTMLElement).style.width).toBe("80%");
    expect((drawing as unknown as SVGElement).style.width).toBe("100%");
  });

  it("gives the drawing its title as a tooltip", async () => {
    load.mockResolvedValue(page);
    render(<Ink src={stored} alt="A sketch" title="Monday" />);
    expect((await screen.findByRole("img", { name: "A sketch" })).querySelector("title")?.textContent).toBe("Monday");
  });

  it("shows the PNG as a picture, at half its pixels, when it carries no strokes that can be read", async () => {
    load.mockResolvedValue(null);
    render(<Ink src={stored} alt="A sketch" />);

    const image = (await screen.findByRole("img", { name: "A sketch" })) as HTMLImageElement;
    expect(image.tagName.toLowerCase()).toBe("img");
    expect(image.getAttribute("src")).toBe("/app_data/sketch-0123456789ab.png");
    Object.defineProperty(image, "naturalWidth", { value: 400 });
    fireEvent.load(image);
    expect(image.style.width).toBe("200px");
  });

  it("draws that picture at the density its PNG states, for a drawing too big to be stored at 2 pixels to a point", async () => {
    load.mockResolvedValue(null);
    density.mockResolvedValue(1.64);
    render(<Ink src={stored} alt="A sketch" />);

    const image = (await screen.findByRole("img", { name: "A sketch" })) as HTMLImageElement;
    await vi.waitFor(() => expect(density).toHaveBeenCalledExactlyOnceWith("sketch-0123456789ab.png"));
    Object.defineProperty(image, "naturalWidth", { value: 8192 });
    fireEvent.load(image);
    await vi.waitFor(() => expect(image.style.width).toBe("4995.121951219512px"));
  });

  it("says so when the file is gone", async () => {
    load.mockImplementation(() => Promise.reject(new Error("404")));
    render(<Ink src={stored} alt="A sketch" />);

    const image = await screen.findByRole("img", { name: "A sketch" });
    fireEvent.error(image);
    expect(screen.getByText("Image not found: A sketch")).toBeTruthy();
  });

  it("draws a drawing from a web address as the picture it is, without fetching it itself", () => {
    render(<Ink src="https://example.com/drawing.png" alt="Elsewhere" />);

    expect(screen.getByRole("img", { name: "Elsewhere" }).getAttribute("src")).toBe("https://example.com/drawing.png");
    expect(load).not.toHaveBeenCalled();
  });

  it("asks for a src", () => {
    render(<Ink />);
    expect(screen.getByText("Drawing: add a src")).toBeTruthy();
  });

  it("draws the next drawing when its name changes, not the last", async () => {
    const other: InkDrawing = { ...page, width: 50, height: 30 };
    load.mockResolvedValueOnce(page).mockResolvedValueOnce(other);
    const { rerender } = render(<Ink src={stored} alt="A sketch" />);
    expect((await screen.findByRole("img", { name: "A sketch" })).getAttribute("viewBox")).toBe("0 0 200 120");

    rerender(<Ink src="app_data/other-0123456789ab.png" alt="A sketch" />);
    await vi.waitFor(() => expect(screen.getByRole("img", { name: "A sketch" }).getAttribute("viewBox")).toBe("0 0 50 30"));
  });
});
