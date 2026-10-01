import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { caretCoordinates } from "./caretCoordinates";
import { MENU_WIDTH_PX, optionId } from "./MdxCompletionMenu";
import { expandCompletion, findTrigger, matchCompletions, type MdxCompletion } from "./mdx/completions";

/** Roughly the tallest the menu gets, to decide whether it fits below the caret. */
const MENU_HEIGHT_PX = 200;
const GAP_PX = 4;

type Position = { left: number; top?: number; bottom?: number };

/**
 * Intellisense for MDX components in the editor's textarea: after a `<` it
 * lists the components that match what has been typed, and inserts the chosen
 * one. `insert` swaps `[start, end)` for `text` and puts the caret `caret`
 * characters into it.
 */
export function useMdxCompletion(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
  insert: (start: number, end: number, text: string, caret: number) => void,
) {
  const menuId = useId();
  // Where the caret is, or null when the textarea has no caret or a selection (or isn't focused).
  const [caret, setCaret] = useState<number | null>(null);
  const [position, setPosition] = useState<Position>({ left: 0 });
  const [active, setActive] = useState(0);
  // The `<` the user waved away with Escape; it stays away until they start another tag.
  const [dismissed, setDismissed] = useState<number | null>(null);

  const trigger = useMemo(() => (caret === null ? null : findTrigger(value, caret)), [value, caret]);
  const items = useMemo(() => (trigger ? matchCompletions(trigger.query) : []), [trigger]);
  const shown = trigger !== null && trigger.start !== dismissed && items.length > 0 ? trigger : null;
  const open = shown !== null;
  const activeIndex = Math.min(active, items.length - 1);

  /** Reads where the caret is now; call after anything that can move it or change the text. */
  function sync(el: HTMLTextAreaElement) {
    const collapsed = el.selectionStart === el.selectionEnd;
    const next = collapsed ? findTrigger(el.value, el.selectionStart) : null;
    setCaret(collapsed ? el.selectionStart : null);
    if (next?.query !== trigger?.query) setActive(0);
    if (!next) setDismissed(null);
    if (next) setPosition(placeMenu(el, next.start));
  }

  function accept(item: MdxCompletion) {
    const el = textarea.current;
    if (!el || !shown) return;
    const { text: inserted, caret: offset } = expandCompletion(item);
    insert(shown.start, el.selectionStart, inserted, offset);
    setCaret(shown.start + offset);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shown || event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((activeIndex + 1) % items.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((activeIndex - 1 + items.length) % items.length);
        break;
      case "Enter":
      case "Tab":
        event.preventDefault();
        accept(items[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        setDismissed(shown.start);
        break;
    }
  }

  const style: CSSProperties = { left: position.left, top: position.top, bottom: position.bottom };

  return {
    open,
    menu: { id: menuId, items, active: activeIndex, style, onPick: accept, onHover: setActive },
    /** Props for the textarea, so assistive tech hears the menu as part of it. */
    textareaProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? menuId : undefined,
      "aria-activedescendant": open ? optionId(menuId, items[activeIndex]) : undefined,
      onKeyDown,
      onSelect: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onScroll: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onFocus: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onBlur: () => setCaret(null),
    },
    sync,
  };
}

/** Puts the menu under the `<` at `start`, or above it when it would run off the bottom. */
function placeMenu(el: HTMLTextAreaElement, start: number): Position {
  const { top, left, height } = caretCoordinates(el, start);
  const lineTop = top - el.scrollTop;
  const maxLeft = Math.max(0, el.clientWidth - MENU_WIDTH_PX);
  const x = Math.min(Math.max(0, left - el.scrollLeft), maxLeft);
  const fitsBelow = lineTop + height + GAP_PX + MENU_HEIGHT_PX <= el.clientHeight;
  return fitsBelow || lineTop < MENU_HEIGHT_PX
    ? { left: x, top: lineTop + height + GAP_PX }
    : { left: x, bottom: el.clientHeight - lineTop + GAP_PX };
}
