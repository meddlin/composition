import { useId, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { HIGHLIGHT_MENU_WIDTH_PX, highlightOptionId, type HighlightChoice, type HighlightItem } from "./HighlightMenu";
import { removeHighlight, type TextRange } from "./highlightText";
import { lastHighlightColor } from "./lastHighlightColor";
import { HIGHLIGHT_COLORS } from "./mdx/highlightColors";
import { placeMenu, type Position } from "./useMdxCompletion";

/** Roughly the tallest the menu gets, to decide whether it fits below the selection. */
const MENU_HEIGHT_PX = 240;

const COLOR_ITEMS: HighlightItem[] = HIGHLIGHT_COLORS.map((color, index) => ({
  choice: color,
  label: color[0].toUpperCase() + color.slice(1),
  key: String(index + 1),
}));
const REMOVE_ITEM: HighlightItem = { choice: "remove", label: "Remove highlight", key: "0" };

type Opened = { range: TextRange; canRemove: boolean; position: Position };

/** Cmd/Ctrl+Shift+H, not Alt, and not a key held down. */
const isShortcut = (event: KeyboardEvent) =>
  event.key.toLowerCase() === "h" && event.shiftKey && (event.metaKey || event.ctrlKey) && !event.altKey && !event.repeat;

/**
 * The colour menu for highlighting the editor's selection. Cmd/Ctrl+Shift+H opens it beside the
 * selection, starting on the colour used last; pick with the arrows and Enter, a number key, or the
 * mouse. With only a caret it opens only inside an existing highlight, to recolour or remove it.
 * `apply` does the editing; this decides what is asked of it.
 */
export function useHighlightMenu(
  textarea: RefObject<HTMLTextAreaElement | null>,
  apply: (choice: HighlightChoice, range: TextRange) => void,
) {
  const menuId = useId();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [active, setActive] = useState(0);

  const items = opened?.canRemove ? [...COLOR_ITEMS, REMOVE_ITEM] : COLOR_ITEMS;
  const activeIndex = Math.min(active, items.length - 1);
  const close = () => setOpened(null);

  function open(el: HTMLTextAreaElement) {
    const range = { start: el.selectionStart, end: el.selectionEnd };
    const canRemove = removeHighlight(el.value, range).ok;
    // A caret over plain text has nothing to highlight.
    if (range.start === range.end && !canRemove) return;
    setActive(HIGHLIGHT_COLORS.indexOf(lastHighlightColor()));
    setOpened({ range, canRemove, position: placeMenu(el, range.end, MENU_HEIGHT_PX, HIGHLIGHT_MENU_WIDTH_PX) });
  }

  function pick(choice: HighlightChoice) {
    if (!opened) return;
    close();
    apply(choice, opened.range);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (isShortcut(event)) {
      // Browsers use it too (Chrome's is "Home"); inside the editor it is ours.
      event.preventDefault();
      if (opened) close();
      else open(event.currentTarget);
      return;
    }
    if (!opened) return;

    const byKey = items.find((item) => item.key === event.key);
    if (byKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      pick(byKey.choice);
      return;
    }
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
        pick(items[activeIndex].choice);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      // Shift, Control and the like are on their way to a shortcut; anything else is the user carrying on writing.
      case "Shift":
      case "Control":
      case "Meta":
      case "Alt":
        break;
      default:
        close();
    }
  }

  const style: CSSProperties = opened ? { left: opened.position.left, top: opened.position.top, bottom: opened.position.bottom } : {};
  const open_ = opened !== null;

  return {
    open: open_,
    menu: { id: menuId, items, active: activeIndex, style, onPick: pick, onHover: setActive },
    /** Props for the textarea, so assistive tech hears the menu as part of it. */
    textareaProps: {
      "aria-controls": open_ ? menuId : undefined,
      "aria-activedescendant": open_ ? highlightOptionId(menuId, items[activeIndex].choice) : undefined,
      onKeyDown,
      // The menu is about the selection it opened over; moving it, or leaving, ends the menu.
      onSelect: (event: { currentTarget: HTMLTextAreaElement }) => {
        const el = event.currentTarget;
        if (opened && (el.selectionStart !== opened.range.start || el.selectionEnd !== opened.range.end)) close();
      },
      onBlur: close,
      onScroll: () => {
        if (opened) close();
      },
    },
  };
}
