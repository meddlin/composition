// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Info } from "./Info";

describe("Info", () => {
  afterEach(cleanup);

  it("renders its content as a labelled note", () => {
    render(<Info>Heads up</Info>);

    const note = screen.getByRole("note", { name: "Info" });
    expect(note.textContent).toBe("Heads up");
  });

  it("hides the icon from assistive tech", () => {
    const { container } = render(<Info>Heads up</Info>);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
