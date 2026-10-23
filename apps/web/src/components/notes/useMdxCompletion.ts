import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { caretCoordinates } from "./caretCoordinates";
import { MENU_WIDTH_PX, optionId } from "./MdxCompletionMenu";
import { expandCompletion, findTrigger, matchCompletions, type MdxCompletion } from "./mdx/completions";
import { findFrontmatterTarget } from "./mdx/frontmatterProps";
import { findPropTarget, type PropTarget } from "./mdx/props";

const NO_ITEMS: MdxCompletion[] = [];

/** Roughly the tallest the menu gets, to decide whether it fits below the caret. */
const MENU_HEIGHT_PX = 200;
const GAP_PX = 4;

export type Position = { left: number; top?: number; bottom?: number };

/** What the menu is offering at the caret: the text a choice replaces, and the choices. */
type Target = PropTarget;

/** The components after a `<`, else, inside a component's tag, its props and their values. */
function findTarget(text: string, caret: number): Target | null {
  const tag = findTrigger(text, caret);
  if (tag) return { start: tag.start, end: caret, query: tag.query, items: matchCompletions(tag.query), label: "MDX components" };
  return findPropTarget(text, caret) ?? findFrontmatterTarget(text, caret);
}

/**
 * Intellisense for MDX components in the editor's textarea: after a `<` it
 * lists the components that match what has been typed, and inserts the chosen
 * one. Inside a component's tag it lists the props the tag doesn't have yet
 * and, within a prop's quotes, the values worth trying (`width="50%"`).
 * `insert` swaps `[start, end)` for `text` and puts the caret `caret`
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
  // Where the menu the user waved away with Escape began; it stays away until they start another.
  const [dismissed, setDismissed] = useState<number | null>(null);

  const target = useMemo(() => (caret === null ? null : findTarget(value, caret)), [value, caret]);
  const items = target?.items ?? NO_ITEMS;
  const shown = target !== null && target.start !== dismissed && items.length > 0 ? target : null;
  const open = shown !== null;
  const activeIndex = Math.min(active, items.length - 1);

  /** Reads where the caret is now; call after anything that can move it or change the text. */
  function sync(el: HTMLTextAreaElement) {
    const collapsed = el.selectionStart === el.selectionEnd;
    const next = collapsed ? findTarget(el.value, el.selectionStart) : null;
    setCaret(collapsed ? el.selectionStart : null);
    if (next?.query !== target?.query) setActive(0);
    if (!next) setDismissed(null);
    if (next) setPosition(placeMenu(el, next.start));
  }

  function accept(item: MdxCompletion) {
    const el = textarea.current;
    if (!el || !shown) return;
    const { text: inserted, caret: offset } = expandCompletion(item);
    insert(shown.start, shown.end, inserted, offset);
    setCaret(shown.start + offset);
    // The next menu (a prop's values, after the prop) starts at its top, not where this one's highlight was.
    setActive(0);
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
    menu: { id: menuId, items, label: target?.label ?? "", active: activeIndex, style, onPick: accept, onHover: setActive },
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

/** Puts a menu `menuHeight` tall under the character at `start`, or above it when it would run off the bottom. */
export function placeMenu(
  el: HTMLTextAreaElement,
  start: number,
  menuHeight = MENU_HEIGHT_PX,
  menuWidth = MENU_WIDTH_PX,
): Position {
  const { top, left, height } = caretCoordinates(el, start);
  const lineTop = top - el.scrollTop;
  const maxLeft = Math.max(0, el.clientWidth - menuWidth);
  const x = Math.min(Math.max(0, left - el.scrollLeft), maxLeft);
  const fitsBelow = lineTop + height + GAP_PX + menuHeight <= el.clientHeight;
  return fitsBelow || lineTop < menuHeight
    ? { left: x, top: lineTop + height + GAP_PX }
    : { left: x, bottom: el.clientHeight - lineTop + GAP_PX };
}
