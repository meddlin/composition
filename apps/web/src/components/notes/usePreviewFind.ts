import { useEffect, useRef, useState, type RefObject } from "react";
import { findRanges, type FindOptions } from "./findMatches";
import { clearPreviewHighlights, setPreviewHighlights } from "./previewHighlights";

/** Scrolls `root` just far enough that `range` is in view, with some context above it. */
function scrollIntoView(root: HTMLElement, range: Range) {
  // jsdom has no layout, and so no Range geometry.
  if (typeof range.getBoundingClientRect !== "function") return;
  const target = range.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  const margin = Math.min(48, box.height / 4);
  if (target.top >= box.top + margin && target.bottom <= box.bottom - margin) return;
  root.scrollTop += target.top - box.top - box.height / 3;
}

/**
 * Finds `query` in the rendered preview inside `root`, paints the matches, and scrolls to the
 * `current` one. Returns how many there are. The preview is React's to render, so the search reads
 * the DOM it produced and is repeated whenever that changes (a keystroke in the editor, a code block
 * finishing its syntax colouring).
 */
export function usePreviewFind(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
  query: string,
  { matchCase, wholeWord }: FindOptions,
  current: number,
): number {
  const owner = useRef(Symbol("preview-find"));
  const searchKey = `${query}\u0000${matchCase}\u0000${wholeWord}`;
  const searching = enabled && query !== "";
  const [found, setFound] = useState<{ key: string; ranges: Range[] }>({ key: "", ranges: [] });
  const scrolledTo = useRef("");

  useEffect(() => {
    const el = root.current;
    if (!searching || !el) return;
    let frame = 0;
    const search = () => setFound({ key: searchKey, ranges: findRanges(el, query, { matchCase, wholeWord }) });
    search();
    // The preview re-renders on its own schedule; wait for it to settle before searching again.
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(search);
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [root, searching, searchKey, query, matchCase, wholeWord]);

  // Ranges from an earlier query are not this query's matches.
  const ranges = searching && found.key === searchKey ? found.ranges : NONE;
  const index = ranges.length === 0 ? -1 : Math.min(current, ranges.length - 1);

  useEffect(() => {
    setPreviewHighlights(owner.current, ranges, ranges[index] ?? null);
  }, [ranges, index]);

  useEffect(() => {
    const id = owner.current;
    return () => clearPreviewHighlights(id);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (index === -1 || !el) {
      scrolledTo.current = "";
      return;
    }
    // Only a different match or query moves the view; the same match shifting under edits must not.
    const key = `${searchKey}\u0000${index}`;
    if (scrolledTo.current === key) return;
    scrolledTo.current = key;
    scrollIntoView(el, ranges[index]);
  }, [root, ranges, index, searchKey]);

  return ranges.length;
}

const NONE: Range[] = [];
