import { useEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from "react";
import { caretCoordinates } from "./caretCoordinates";
import { MENU_WIDTH_PX } from "./MdxCompletionMenu";

/**
 * What the writing features (the `<` menu, the note-link and image pickers, the highlight menu) need of
 * whichever editor is showing. They are written against this rather than against a textarea, so the plain
 * editor and the live one can share them: each answers these questions its own way.
 */
export interface EditorSurface {
  /** The note's text as the editor has it right now (which can be ahead of what React last rendered). */
  text(): string;
  selection(): { start: number; end: number };
  /** Swaps `[start, end)` for `text` and puts the caret `caret` characters into it (by default, after it). */
  replace(start: number, end: number, text: string, caret?: number): void;
  setSelection(start: number, end: number): void;
  /** Where the character at `pos` is, in the box the menus are placed in, with the editor's own scrolling already taken off. */
  coordsAt(pos: number): { left: number; top: number; height: number };
  /** The visible size of that box, for deciding whether a menu fits below a line or has to go above it. */
  box(): { width: number; height: number };
  hasFocus(): boolean;
}

/**
 * A key press as the writing features see it: only what they read, so a React event from a textarea and a native
 * event from the live editor both fit (see `fromReactKey`).
 */
export type EditorKeyEvent = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
};

/** A React keyboard event as an `EditorKeyEvent`. It stays the same event: `preventDefault` reaches it, and `defaultPrevented` reads it. */
export function fromReactKey(event: KeyboardEvent): EditorKeyEvent {
  return {
    key: event.key,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    isComposing: event.nativeEvent.isComposing,
    get defaultPrevented() {
      return event.defaultPrevented;
    },
    preventDefault: () => event.preventDefault(),
  };
}

/**
 * The plain editor's textarea as a surface. The textarea is read when asked, not when this is made, since it is
 * not there on the first render; `replace` is the editor's own way of changing the text (which keeps the caret
 * where it should be afterwards), and the latest one is always the one used.
 */
export function useTextareaSurface(
  textarea: RefObject<HTMLTextAreaElement | null>,
  replace: (start: number, end: number, text: string, caret: number) => void,
): EditorSurface {
  const latestReplace = useRef(replace);
  useEffect(() => {
    latestReplace.current = replace;
  });

  return useMemo<EditorSurface>(
    () => ({
      text: () => textarea.current?.value ?? "",
      selection: () => ({ start: textarea.current?.selectionStart ?? 0, end: textarea.current?.selectionEnd ?? 0 }),
      replace: (start, end, text, caret = text.length) => latestReplace.current(start, end, text, caret),
      setSelection: (start, end) => textarea.current?.setSelectionRange(start, end),
      coordsAt(pos) {
        const el = textarea.current;
        if (!el) return { left: 0, top: 0, height: 0 };
        const { top, left, height } = caretCoordinates(el, pos);
        return { left: left - el.scrollLeft, top: top - el.scrollTop, height };
      },
      box: () => ({ width: textarea.current?.clientWidth ?? 0, height: textarea.current?.clientHeight ?? 0 }),
      hasFocus: () => textarea.current !== null && document.activeElement === textarea.current,
    }),
    [textarea],
  );
}

/** Where a menu goes, within the editor's box: from the left, and from the top or (when it has to go above the line) from the bottom. */
export type Position = { left: number; top?: number; bottom?: number };

/** Roughly the tallest the completion menu gets, to decide whether it fits below the caret. */
const MENU_HEIGHT_PX = 200;
const GAP_PX = 4;

/** Puts a menu `menuHeight` tall under the character at `start`, or above it when it would run off the bottom. */
export function placeMenu(
  surface: EditorSurface,
  start: number,
  menuHeight = MENU_HEIGHT_PX,
  menuWidth = MENU_WIDTH_PX,
): Position {
  const { top: lineTop, left, height } = surface.coordsAt(start);
  const box = surface.box();
  const x = Math.min(Math.max(0, left), Math.max(0, box.width - menuWidth));
  const fitsBelow = lineTop + height + GAP_PX + menuHeight <= box.height;
  return fitsBelow || lineTop < menuHeight
    ? { left: x, top: lineTop + height + GAP_PX }
    : { left: x, bottom: box.height - lineTop + GAP_PX };
}
