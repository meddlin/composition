// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInkText } from "@/lib/composition/ink";
import { loadInkDrawing } from "@/lib/composition/inkDrawings";
import { NoteMarkdown } from "./NoteMarkdown";

vi.mock("@/lib/composition/inkDrawings", () => ({ loadInkDrawing: vi.fn(), loadInkDensity: vi.fn(() => Promise.resolve(2)) }));

// jsdom's `import.meta.url` is not a file URL, so the corpus is found by path.
const page = parseInkText(fs.readFileSync(path.join(__dirname, "../../../../../fixtures/conformance/ink/drawing.json"), "utf8"));

afterEach(cleanup);

describe("NoteMarkdown with an <Ink> drawing", () => {
  it("draws it from its strokes among the note's text, with no notice about an unknown component", async () => {
    vi.mocked(loadInkDrawing).mockResolvedValue(page);
    render(
      <NoteMarkdown
        body={'# Trip\n\nBefore.\n\n<Ink src="app_data/trip-plan-drawing-3f9c2a71b0de.png" alt="Route sketch" width="80%" />\n\nAfter.'}
        rehypePlugins={[]}
      />,
    );

    const drawing = await screen.findByRole("img", { name: "Route sketch" });
    expect(drawing.tagName.toLowerCase()).toBe("svg");
    expect(drawing.querySelectorAll("path")).toHaveLength(4);
    expect(loadInkDrawing).toHaveBeenCalledWith("trip-plan-drawing-3f9c2a71b0de.png");
    expect(screen.getByRole("heading", { name: "Trip" })).toBeDefined();
    expect(screen.getByText("After.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws it in the middle of a sentence too", async () => {
    vi.mocked(loadInkDrawing).mockResolvedValue(page);
    render(<NoteMarkdown body={'See <Ink src="app_data/a-0123456789ab.png" alt="Sketch" /> here.'} rehypePlugins={[]} />);

    expect((await screen.findByRole("img", { name: "Sketch" })).tagName.toLowerCase()).toBe("svg");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
