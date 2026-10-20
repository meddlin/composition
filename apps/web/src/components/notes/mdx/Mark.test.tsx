// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Mark } from "./Mark";

describe("Mark", () => {
  afterEach(cleanup);

  it("renders its content in a <mark> carrying its colour", () => {
    const { container } = render(<Mark color="green">careful</Mark>);

    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("careful");
    expect(mark?.getAttribute("data-color")).toBe("green");
  });

  it.each([undefined, "", "magenta", "#ff0"])("falls back to yellow for the colour %j", (color) => {
    const { container } = render(<Mark color={color}>careful</Mark>);

    expect(container.querySelector("mark")?.getAttribute("data-color")).toBe("yellow");
  });
});
