import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { parse } from "@/lib/composition/frontmatter";
import { caretCoordinates } from "./caretCoordinates";
import { extractHeadings, type NoteHeading } from "./noteHeadings";
import { useDebouncedValue } from "./useDebouncedValue";
import type { RailHeading } from "./HeadingRail";

/** Space kept above a heading the rail scrolls to. */
const MARGIN = 8;

/** What `HeadingRail` is given for one of the editor's three views (its props, bar `lookahead`). */
type Rail = {
  headings: readonly RailHeading[];
  scroller: () => HTMLElement | null;
  positions: () => number[];
  scrollTo: (index: number) => void;
  layoutKey?: unknown;
};

const NONE: readonly NoteHeading[] = [];

/** The headings of the note's text, a moment after typing stops (finding them is cheap; placing them in a textarea is not). */
function useSourceHeadings(text: string, enabled: boolean): readonly NoteHeading[] {
  const settled = useDebouncedValue(text, 200);
  return useMemo(() => (enabled ? extractHeadings(settled, settled.length - parse(settled)[1].length) : NONE), [settled, enabled]);
}

/** The rail for the plain Markdown editor: headings found in the text, placed by laying the text out in a hidden copy. */
export function useTextareaRail(textarea: RefObject<HTMLTextAreaElement | null>, text: string, enabled: boolean): Rail {
  const headings = useSourceHeadings(text, enabled);
  const placed = useRef<{ headings: readonly NoteHeading[]; width: number; tops: number[] } | null>(null);

  const tops = useCallback(() => {
    const el = textarea.current;
    if (!el) return [];
    // Laying out is the costly part, and only a different set of headings or a different width changes the answer.
    if (placed.current?.headings !== headings || placed.current.width !== el.clientWidth) {
      placed.current = {
        headings,
        width: el.clientWidth,
        tops: headings.map((heading) => caretCoordinates(el, Math.min(heading.offset, el.value.length)).top),
      };
    }
    return placed.current.tops;
  }, [textarea, headings]);

  return {
    headings,
    scroller: useCallback(() => textarea.current, [textarea]),
    positions: tops,
    scrollTo: useCallback(
      (index) => {
        const el = textarea.current;
        const top = tops()[index];
        if (el && top !== undefined) el.scrollTo({ top: Math.max(0, top - MARGIN) });
      },
      [textarea, tops],
    ),
  };
}

/** The rail for the live editor, which knows where its own lines are (and re-estimates as it draws them). */
export function useLiveRail(view: RefObject<EditorView | null>, text: string, enabled: boolean): Rail {
  const headings = useSourceHeadings(text, enabled);

  const positions = useCallback(() => {
    const editor = view.current;
    if (!editor) return [];
    const { doc } = editor.state;
    return headings.map((heading) => editor.lineBlockAt(Math.min(heading.offset, doc.length)).top + editor.documentPadding.top);
  }, [view, headings]);

  return {
    headings,
    scroller: useCallback(() => view.current?.scrollDOM ?? null, [view]),
    positions,
    scrollTo: useCallback(
      (index) => {
        const editor = view.current;
        const heading = headings[index];
        if (!editor || !heading) return;
        editor.dispatch({
          effects: EditorView.scrollIntoView(Math.min(heading.offset, editor.state.doc.length), { y: "start", yMargin: MARGIN }),
        });
      },
      [view, headings],
    ),
  };
}

/** The rail for the preview: its headings are the ones it drew, so it reads them off the page. */
export function usePreviewRail(box: RefObject<HTMLElement | null>, enabled: boolean): Rail {
  const [elements, setElements] = useState<readonly HTMLElement[]>([]);

  // The headings the preview holds, now and whenever what it has drawn changes (the Markdown, drawn by then).
  useEffect(() => {
    const root = enabled ? box.current : null;
    if (!root) return;
    const scan = () => {
      // The note's own title, in the frontmatter card's <header>, is not one of its headings.
      const found = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).filter((el) => !el.closest("header"));
      setElements((current) => (current.length === found.length && current.every((el, i) => el === found[i]) ? current : found));
    };
    const first = requestAnimationFrame(scan);
    const changes = new MutationObserver(scan);
    changes.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(first);
      changes.disconnect();
    };
  }, [box, enabled]);

  const headings = useMemo(
    () => elements.map((el) => ({ level: Number(el.tagName[1]), label: (el.textContent ?? "").trim() })),
    [elements],
  );
  const positions = useCallback(() => {
    const root = box.current;
    if (!root) return [];
    const origin = root.getBoundingClientRect().top - root.scrollTop;
    return elements.map((el) => el.getBoundingClientRect().top - origin);
  }, [box, elements]);

  return {
    headings,
    scroller: useCallback(() => box.current, [box]),
    positions,
    scrollTo: useCallback(
      (index) => {
        const top = positions()[index];
        if (top !== undefined) box.current?.scrollTo({ top: Math.max(0, top - MARGIN) });
      },
      [box, positions],
    ),
  };
}
