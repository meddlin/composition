// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeHeading, HeadingRail } from "./HeadingRail";

afterEach(cleanup);

describe("activeHeading", () => {
  const tops = [0, 100, 300, 600];

  it("is the last heading at or above the top of the view", () => {
    expect(activeHeading(tops, 0, false, 0)).toBe(0);
    expect(activeHeading(tops, 150, false, 0)).toBe(1);
    expect(activeHeading(tops, 300, false, 0)).toBe(2);
  });

  it("counts a heading just below the top as reached", () => {
    expect(activeHeading(tops, 80, false, 24)).toBe(1);
    expect(activeHeading(tops, 80, false, 0)).toBe(0);
  });

  it("is the first heading before any has scrolled past, and the last at the end", () => {
    expect(activeHeading([40, 90], 0, false, 0)).toBe(0);
    expect(activeHeading(tops, 400, true, 24)).toBe(3);
  });

  it("is nothing without headings", () => {
    expect(activeHeading([], 0, false, 0)).toBe(-1);
  });
});

describe("HeadingRail", () => {
  const headings = [
    { level: 1, label: "Intro" },
    { level: 2, label: "Details" },
    { level: 3, label: "Fine print" },
  ];

  function renderRail(scrollTop = 0, onScrollTo = vi.fn()) {
    const scroller = document.createElement("div");
    scroller.scrollTop = scrollTop;
    render(<HeadingRail headings={headings} scroller={() => scroller} positions={() => [0, 100, 300]} scrollTo={onScrollTo} lookahead={0} />);
    return { scroller, onScrollTo };
  }

  it("has a tick for each heading, longer for a higher level", () => {
    renderRail();

    const ticks = screen.getAllByRole("button");
    expect(ticks.map((tick) => tick.getAttribute("aria-label"))).toEqual(["Intro", "Details", "Fine print"]);
    const widths = ticks.map((tick) => parseInt((tick.firstElementChild as HTMLElement).style.width));
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });

  it("marks the heading being read and follows the scrolling", () => {
    const { scroller } = renderRail();
    expect(screen.getByRole("button", { name: "Intro" }).getAttribute("aria-current")).toBe("location");

    act(() => {
      scroller.scrollTop = 150;
      fireEvent.scroll(scroller);
    });

    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-current")).toBe("location");
    expect(screen.getByRole("button", { name: "Intro" }).getAttribute("aria-current")).toBeNull();
  });

  it("scrolls to a heading when its tick is clicked", () => {
    const { onScrollTo } = renderRail();

    fireEvent.click(screen.getByRole("button", { name: "Fine print" }));

    expect(onScrollTo).toHaveBeenCalledWith(2);
  });

  it("sits on the right edge when asked to", () => {
    render(<HeadingRail headings={headings} scroller={() => null} positions={() => []} scrollTo={() => {}} side="right" />);

    const rail = screen.getByTestId("heading-rail");
    expect(rail.className).toContain("right-0");
    expect(rail.className).not.toContain("left-0");
  });

  it("is not drawn for a note with fewer than two headings", () => {
    render(<HeadingRail headings={headings.slice(0, 1)} scroller={() => null} positions={() => []} scrollTo={() => {}} />);

    expect(screen.queryByTestId("heading-rail")).toBeNull();
  });
});
