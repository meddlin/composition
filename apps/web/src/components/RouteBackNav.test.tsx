// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteBackNav } from "./RouteBackNav";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RouteBackNav", () => {
  it("steps the browser history with the mouse's Back and Forward buttons", () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(2);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    render(<RouteBackNav />);

    fireEvent.mouseUp(document.body, { button: 3 });
    expect(back).toHaveBeenCalledTimes(1);

    fireEvent.mouseUp(document.body, { button: 4 });
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("stays put when there is nothing behind the screen", () => {
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    render(<RouteBackNav />);

    fireEvent.mouseUp(document.body, { button: 3 });
    expect(back).not.toHaveBeenCalled();
  });
});
