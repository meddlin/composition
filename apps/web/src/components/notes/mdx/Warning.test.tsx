// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Warning } from "./Warning";

describe("Warning", () => {
  afterEach(cleanup);

  it("renders its content as a labelled note", () => {
    render(<Warning>Careful</Warning>);

    expect(screen.getByRole("note", { name: "Warning" }).textContent).toBe("Careful");
  });

  it("uses the warning color and hides the icon from assistive tech", () => {
    const { container } = render(<Warning>Careful</Warning>);

    expect(screen.getByRole("note").className).toContain("bg-warning/10");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
