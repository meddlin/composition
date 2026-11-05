"use client";

import { useEffect, useState } from "react";
import type { HeadingRailSide } from "@/lib/composition/writing";
import { cn } from "@/lib/utils";

/** What the rail needs to know of a heading: how deep it is and what it says. */
export type RailHeading = { level: number; label: string };

type Props = {
  headings: readonly RailHeading[];
  /** The element that scrolls the text, or null while it isn't there. */
  scroller: () => HTMLElement | null;
  /** Where each heading sits in the scroller's own coordinates (the same ones as its `scrollTop`), one per heading. */
  positions: () => number[];
  /** Brings the heading at `index` to the top of the scroller. */
  scrollTo: (index: number) => void;
  /** Anything that can move headings without `headings` changing (the text being reflowed by a new width, say). */
  layoutKey?: unknown;
  /** Which edge of the text the rail is on. */
  side?: HeadingRailSide;
  /** Where the active heading is counted from: a heading at or above this far below the top counts as reached. */
  lookahead?: number;
};

// The longest bar is for the first level; every level past the fourth is the same short bar.
const BAR_WIDTH = [10, 8, 6, 4];
const PITCH = 9;

/**
 * Room the rail takes at the left of the text, in px: 10 of padding on each side of the longest tick. The editor and the
 * preview pad their text by this much (instead of 1rem) while the rail is on, so the rail has a gutter of its own.
 */
export const RAIL_GUTTER_PX = 30;

/** The active heading: the last one at or above the top of the view, or the last one at all once scrolled to the end. */
export function activeHeading(tops: readonly number[], scrollTop: number, atEnd: boolean, lookahead: number): number {
  if (tops.length === 0) return -1;
  if (atEnd) return tops.length - 1;
  let active = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= scrollTop + lookahead) active = i;
  }
  return active;
}

/**
 * A narrow rail of ticks down the left edge of a note, one for each heading (longer for a higher level) with the
 * heading being read lit. A tick scrolls to its heading. It belongs inside a `relative` box that is the same size
 * as the text it follows, and is not drawn for a note with fewer than two headings.
 */
export function HeadingRail({ headings, scroller, positions, scrollTo, layoutKey, side = "left", lookahead = 24 }: Props) {
  const [active, setActive] = useState(0);
  // A scrollbar that takes room (not an overlay one) sits at the right edge, and the rail must stay clear of it there.
  const [scrollbar, setScrollbar] = useState(0);

  useEffect(() => {
    const el = scroller();
    if (!el) return;
    const update = () => {
      setScrollbar(el.offsetWidth - el.clientWidth);
      const atEnd = el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      setActive(activeHeading(positions(), el.scrollTop, atEnd, lookahead));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  }, [scroller, positions, headings, layoutKey, lookahead]);

  if (headings.length < 2) return null;

  return (
    <nav
      aria-label="Headings"
      data-testid="heading-rail"
      className={cn("absolute top-5 z-10 flex w-[30px] flex-col justify-between px-2.5", side === "left" ? "left-0" : "right-0")}
      // Room for a tick each, and no more than the box has; many headings are packed closer together.
      style={{ height: `min(${headings.length * PITCH}px, 70%)`, ...(side === "right" && { right: scrollbar }) }}
    >
      {headings.map((heading, index) => (
        <button
          key={index}
          type="button"
          title={heading.label || `Heading ${index + 1}`}
          aria-label={heading.label || `Heading ${index + 1}`}
          aria-current={index === active ? "location" : undefined}
          onClick={() => scrollTo(index)}
          className={cn("group flex min-h-0 flex-1 cursor-pointer items-center", side === "right" && "justify-end")}
        >
          <span
            aria-hidden
            data-level={heading.level}
            className={cn(
              "h-0.5 rounded-full transition-colors",
              index === active ? "bg-brand" : "bg-foreground/40 group-hover:bg-foreground/70",
            )}
            style={{ width: BAR_WIDTH[Math.min(heading.level, 4) - 1] }}
          />
        </button>
      ))}
    </nav>
  );
}
