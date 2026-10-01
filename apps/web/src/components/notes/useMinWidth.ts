import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether the element is at least `minPx` wide, kept current as it is resized.
 * Counts as wide until it has been measured (on the server, or in a test with
 * no layout), so nothing is hidden on a guess.
 */
export function useMinWidth(ref: RefObject<HTMLElement | null>, minPx: number): boolean {
  const [wide, setWide] = useState(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // An unmeasurable width (0) says nothing about how much room there is.
    const measure = (width: number) => {
      if (width > 0) setWide(width >= minPx);
    };
    measure(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, minPx]);

  return wide;
}
