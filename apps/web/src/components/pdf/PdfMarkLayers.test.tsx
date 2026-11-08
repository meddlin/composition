// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotation } from "@/lib/composition/documentsApi";
import type { PageViewportLike } from "./pdfGeometry";
import { MarkLayers, usePageLayers, type MarkLayersProps, type PageLayers } from "./PdfMarkLayers";
import { fakeControls } from "./fakeControls";
import { renderHook, act } from "@testing-library/react";

afterEach(cleanup);

/** A 612 x 792 pt page at scale 2: a point is two pixels, and y runs the other way. */
const viewport: PageViewportLike = {
  convertToViewportPoint: (x, y) => [x * 2, (792 - y) * 2],
  convertToPdfPoint: (x, y) => [x / 2, 792 - y / 2],
};

function pageLayers(pageNumber = 4): PageLayers {
  const element = document.createElement("div");
  element.className = "page";
  element.dataset.pageNumber = String(pageNumber);
  const under = document.createElement("div");
  const over = document.createElement("div");
  element.append(under, over);
  document.body.append(element);
  return { pageNumber, element, viewport, under, over };
}

const mark = (id: number, over: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
  id, uuid: String(id).padStart(32, "0"), documentId: 1, page: 3, kind: "highlight", color: "yellow", rects: [[100, 700, 300, 720]], quote: "words", comment: "", body: null, groupUuid: null, createdAt: "t", updatedAt: "t", ...over,
});

function props(over: Partial<MarkLayersProps> = {}): MarkLayersProps {
  return {
    layers: [pageLayers()],
    marks: [],
    selectedId: null,
    placing: false,
    draft: null,
    editingId: null,
    onPlace: vi.fn(),
    onCommitDraft: vi.fn(),
    onCancelDraft: vi.fn(),
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onCommitEdit: vi.fn(),
    onRecolor: vi.fn(),
    onComment: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
}

const note = (id: number, text = "A note", over: Partial<PdfAnnotation> = {}) => mark(id, { kind: "text", rects: null, color: "yellow", body: { rect: [50, 600, 250, 656], text, fontSize: 12 }, quote: "", ...over });

describe("marks on the text", () => {
  it("draws a highlight over the line it marks, where its rectangle is on the page at this zoom", () => {
    const p = props({ marks: [mark(1)] });
    render(<MarkLayers {...p} />);

    const box = p.layers[0].under.querySelector<HTMLElement>('[data-mark-id="1"]')!;
    expect(box.dataset.markKind).toBe("highlight");
    expect(box.style.left).toBe("200px");
    expect(box.style.top).toBe("144px");
    expect(box.style.width).toBe("400px");
    expect(box.style.height).toBe("40px");
    expect(box.style.mixBlendMode).toBe("multiply");
  });

  it("lightens the page under a highlight on dark pages, where multiplying by a dark page would hide it", () => {
    const p = props({ marks: [mark(1)], dark: true });
    render(<MarkLayers {...p} />);

    const box = p.layers[0].under.querySelector<HTMLElement>('[data-mark-id="1"]')!;
    expect(box.style.mixBlendMode).toBe("screen");
  });

  it("draws a rectangle for each line of a mark, and leaves other pages' marks to their own pages", () => {
    const p = props({ marks: [mark(1, { rects: [[100, 700, 300, 720], [100, 680, 250, 700]] }), mark(2, { page: 9 })] });
    render(<MarkLayers {...p} />);

    expect(p.layers[0].under.querySelectorAll('[data-mark-id="1"]')).toHaveLength(2);
    expect(p.layers[0].under.querySelector('[data-mark-id="2"]')).toBeNull();
  });

  it("draws an underline as a line along the bottom and a strikethrough as a line through the middle, in the color's own line color", () => {
    const p = props({ marks: [mark(1, { kind: "underline", color: "green" }), mark(2, { kind: "strikethrough", color: "pink" })] });
    render(<MarkLayers {...p} />);

    const underline = p.layers[0].under.querySelector<HTMLElement>('[data-mark-id="1"]')!;
    const strike = p.layers[0].under.querySelector<HTMLElement>('[data-mark-id="2"]')!;
    expect(underline.style.mixBlendMode).toBe("");
    expect(underline.firstElementChild?.getAttribute("style")).toContain("bottom: 0");
    expect(strike.firstElementChild?.getAttribute("style")).toContain("top:");
    expect(strike.firstElementChild?.getAttribute("style")).not.toContain("bottom");
    expect(underline.firstElementChild?.getAttribute("style")).not.toBe(strike.firstElementChild?.getAttribute("style"));
  });

  it("rings the mark that is selected", () => {
    const p = props({ marks: [mark(1), mark(2)], selectedId: 2 });
    render(<MarkLayers {...p} />);

    expect(p.layers[0].under.querySelector<HTMLElement>('[data-mark-id="2"]')!.style.outline).toContain("2px solid");
    expect(p.layers[0].under.querySelector<HTMLElement>('[data-mark-id="1"]')!.style.outline).toBe("");
  });

  it("does not take the mouse, so the text under it can still be selected", () => {
    const p = props({ marks: [mark(1)] });
    render(<MarkLayers {...p} />);

    expect(p.layers[0].under.querySelector<HTMLElement>('[data-mark-id="1"]')!.style.pointerEvents).toBe("");
    // the layer itself, which is where the pointer-events rule lives, is made by `usePageLayers`
  });
});

describe("text notes", () => {
  it("shows a note's words in its box, in the page's units, and selects it on a click", () => {
    const p = props({ marks: [note(5, "Check the proof")] });
    render(<MarkLayers {...p} />);

    const box = within(p.layers[0].over).getByRole("note");
    expect(box.textContent).toBe("Check the proof");
    expect(box.style.left).toBe("100px");
    expect(box.style.width).toBe("400px");
    expect(box.style.fontSize).toBe("24px");
    fireEvent.click(box);
    expect(p.onSelect).toHaveBeenCalledWith(5);
  });

  it("is retyped on a double click: a box with the words, kept when it is left, dropped on Escape", () => {
    const p = props({ marks: [note(5, "Old words")] });
    const { rerender } = render(<MarkLayers {...p} />);
    fireEvent.doubleClick(within(p.layers[0].over).getByRole("note"));
    expect(p.onEdit).toHaveBeenCalledWith(5);

    const editing = props({ ...p, marks: [note(5, "Old words")], editingId: 5 });
    rerender(<MarkLayers {...editing} />);
    const box = within(editing.layers[0].over).getByRole("textbox", { name: "Text note" }) as HTMLTextAreaElement;
    expect(box.value).toBe("Old words");
    fireEvent.change(box, { target: { value: "New words" } });
    fireEvent.blur(box);
    expect(editing.onCommitEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), "New words");

    fireEvent.keyDown(box, { key: "Escape" });
    expect(editing.onEdit).toHaveBeenCalledWith(null);
  });

  it("leaves an edit on Ctrl+Enter, but writes a new line on Enter", () => {
    const p = props({ marks: [note(5)], editingId: 5 });
    render(<MarkLayers {...p} />);
    const box = within(p.layers[0].over).getByRole("textbox", { name: "Text note" });

    fireEvent.keyDown(box, { key: "Enter" });
    expect(p.onCommitEdit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(p.onCommitEdit).toHaveBeenCalledTimes(1);
  });

  it("shows a draft box where a note is being placed, and gives its words when it is left", () => {
    const p = props({ draft: { page: 3, rect: [100, 600, 300, 656] } });
    render(<MarkLayers {...p} />);

    const box = within(p.layers[0].over).getByRole("textbox", { name: "Text note" }) as HTMLTextAreaElement;
    expect(box.style.left).toBe("200px");
    fireEvent.change(box, { target: { value: "Remember this" } });
    fireEvent.blur(box);
    expect(p.onCommitDraft).toHaveBeenCalledWith("Remember this");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(p.onCancelDraft).toHaveBeenCalled();
  });

  it("puts a note where the page is clicked while placing, with a default box at that point", () => {
    const p = props({ placing: true });
    render(<MarkLayers {...p} />);
    const catcher = within(p.layers[0].over).getByRole("button", { name: "Place a text note on page 4" });
    catcher.getBoundingClientRect = () => ({ left: 10, top: 20, right: 0, bottom: 0, width: 0, height: 0, x: 10, y: 20, toJSON() {} });

    fireEvent.click(catcher, { clientX: 210, clientY: 420 });

    // the click is 200 px right and 400 px down of the page's corner: 100 pt and 200 pt, and a 200 x 56 pt box going down from there
    expect(p.onPlace).toHaveBeenCalledWith(3, [100, 792 - 200 - 56, 300, 792 - 200]);
  });

  it("offers no placing catcher when not placing", () => {
    const p = props();
    render(<MarkLayers {...p} />);

    expect(within(p.layers[0].over).queryByRole("button", { name: /Place a text note/ })).toBeNull();
  });
});

describe("the popover of a selected mark", () => {
  it("offers the five colors, the current one pressed, and recolors on a click", () => {
    const p = props({ marks: [mark(1, { color: "green" })], selectedId: 1 });
    render(<MarkLayers {...p} />);
    const popover = within(p.layers[0].over).getByRole("dialog", { name: "Mark" });

    expect(within(popover).getByRole("button", { name: "Green" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(popover).getByRole("button", { name: "Pink" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(within(popover).getByRole("button", { name: "Pink" }));
    expect(p.onRecolor).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "pink");
  });

  it("saves a comment on Enter and on leaving the box, and not when it did not change", () => {
    const p = props({ marks: [mark(1, { comment: "first" })], selectedId: 1 });
    render(<MarkLayers {...p} />);
    const box = within(p.layers[0].over).getByRole("textbox", { name: "Comment" }) as HTMLInputElement;

    fireEvent.blur(box);
    expect(p.onComment).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "second" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(p.onComment).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "second");
    fireEvent.change(box, { target: { value: "third" } });
    fireEvent.blur(box);
    expect(p.onComment).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1 }), "third");
  });

  it("deletes the mark", () => {
    const p = props({ marks: [mark(1)], selectedId: 1 });
    render(<MarkLayers {...p} />);

    fireEvent.click(within(p.layers[0].over).getByRole("button", { name: "Delete this mark" }));

    expect(p.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("has no comment box for a text note, which is its words", () => {
    const p = props({ marks: [note(5)], selectedId: 5 });
    render(<MarkLayers {...p} />);

    expect(within(p.layers[0].over).queryByRole("textbox", { name: "Comment" })).toBeNull();
    expect(within(p.layers[0].over).getByRole("button", { name: "Delete this mark" })).toBeTruthy();
  });

  it("is gone while a text note is being placed or retyped", () => {
    const selected = [mark(1)];
    const placing = props({ marks: selected, selectedId: 1, placing: true });
    const { rerender } = render(<MarkLayers {...placing} />);
    expect(within(placing.layers[0].over).queryByRole("dialog")).toBeNull();

    rerender(<MarkLayers {...props({ layers: placing.layers, marks: [note(5)], selectedId: 5, editingId: 5 })} />);
    expect(within(placing.layers[0].over).queryByRole("dialog")).toBeNull();
  });
});

describe("the layers in a page", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function drawnPage(): HTMLElement {
    const page = document.createElement("div");
    page.className = "page";
    page.dataset.pageNumber = "1";
    page.innerHTML = '<div class="canvasWrapper"></div><div class="textLayer"></div>';
    document.body.append(page);
    return page;
  }

  it("puts one under the text, right after the page image, and one over everything, that take no mouse", async () => {
    const page = drawnPage();
    const controls = fakeControls({ pagesOnScreen: vi.fn(() => [{ pageNumber: 1, element: page, viewport }]) });

    const { result } = renderHook(() => usePageLayers(controls));
    await act(async () => void (await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))));

    expect(result.current).toHaveLength(1);
    const [layers] = result.current;
    expect(layers.under.previousElementSibling?.className).toBe("canvasWrapper");
    expect(layers.under.nextElementSibling?.className).toBe("textLayer");
    expect(page.lastElementChild).toBe(layers.over);
    expect(layers.under.style.pointerEvents).toBe("none");
    expect(layers.over.style.pointerEvents).toBe("none");
  });

  it("makes them again when pdf.js has drawn the page again and swept them away, and not twice when it has not", async () => {
    const page = drawnPage();
    const controls = fakeControls({ pagesOnScreen: vi.fn(() => [{ pageNumber: 1, element: page, viewport }]) });
    let changed = () => {};
    controls.onPagesChanged = vi.fn((listener) => {
      changed = listener;
      return () => {};
    });
    const { result } = renderHook(() => usePageLayers(controls));
    await act(async () => void (await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))));
    const first = result.current[0];

    act(() => changed());
    expect(result.current[0].under).toBe(first.under);
    expect(page.querySelectorAll(".pdfMarkLayer-under")).toHaveLength(1);

    first.under.remove();
    first.over.remove();
    act(() => changed());
    expect(result.current[0].under).not.toBe(first.under);
    expect(page.querySelectorAll(".pdfMarkLayer-under")).toHaveLength(1);
  });

  it("has none before the reader is ready, and stops listening when it is gone", () => {
    const stop = vi.fn();
    const controls = fakeControls({ onPagesChanged: vi.fn(() => stop) });

    expect(renderHook(() => usePageLayers(null)).result.current).toEqual([]);
    renderHook(() => usePageLayers(controls)).unmount();

    expect(stop).toHaveBeenCalled();
  });
});
