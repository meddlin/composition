// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle";

function setup() {
  const handlers = { onResizeStart: vi.fn(), onResize: vi.fn(), onResizeEnd: vi.fn() };
  render(<ResizeHandle label="Resize panes" valueNow={50} valueMin={20} valueMax={80} {...handlers} />);
  return { ...handlers, handle: screen.getByRole("separator", { name: "Resize panes" }) };
}

describe("ResizeHandle", () => {
  afterEach(cleanup);

  it("exposes its range to assistive tech", () => {
    const { handle } = setup();

    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    expect(handle.getAttribute("aria-valuemin")).toBe("20");
    expect(handle.getAttribute("aria-valuemax")).toBe("80");
  });

  it("reports the offset from where the drag started, then ends on release", () => {
    const { handle, onResizeStart, onResize, onResizeEnd } = setup();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    expect(onResizeStart).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    expect(onResize.mock.calls).toEqual([[30], [-30]]);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it("ends the drag on pointer cancel and ignores moves afterwards", () => {
    const { handle, onResize, onResizeEnd } = setup();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("ignores moves that were not preceded by a press", () => {
    const { handle, onResize, onResizeEnd } = setup();

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  it("ignores non-primary buttons", () => {
    const { handle, onResizeStart } = setup();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 2, clientX: 100 });

    expect(onResizeStart).not.toHaveBeenCalled();
  });

  it("locks the cursor and text selection while dragging, then restores them", () => {
    const { handle } = setup();

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("steps with the arrow keys and saves on key up", () => {
    const { handle, onResizeStart, onResize, onResizeEnd } = setup();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResizeStart).toHaveBeenCalledTimes(2);
    expect(onResize.mock.calls).toEqual([[16], [-16]]);
    expect(onResizeEnd).not.toHaveBeenCalled();

    fireEvent.keyUp(handle, { key: "ArrowLeft" });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const { handle, onResizeStart, onResizeEnd } = setup();

    fireEvent.keyDown(handle, { key: "a" });
    fireEvent.keyUp(handle, { key: "a" });

    expect(onResizeStart).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});
