import { useId, useMemo, useState, type CSSProperties } from "react";
import { placeMenu, type EditorKeyEvent, type EditorSurface, type Position } from "./editorSurface";
import { optionId } from "./MdxCompletionMenu";
import { expandCompletion, findTrigger, matchCompletions, type MdxCompletion } from "./mdx/completions";
import { findFrontmatterTarget } from "./mdx/frontmatterProps";
import { findPropTarget, type PropTarget } from "./mdx/props";
import { findSnippetTarget } from "./mdx/snippets";

const NO_ITEMS: MdxCompletion[] = [];

/** What the menu is offering at the caret: the text a choice replaces, and the choices. */
type Target = PropTarget;

/** The components after a `<`, else, inside a component's tag, its props and their values. */
function findTarget(text: string, caret: number): Target | null {
  const tag = findTrigger(text, caret);
  if (tag) return { start: tag.start, end: caret, query: tag.query, items: matchCompletions(tag.query), label: "MDX components" };
  return findPropTarget(text, caret) ?? findFrontmatterTarget(text, caret) ?? findSnippetTarget(text, caret);
}

/**
 * Intellisense for MDX components in the editor: after a `<` it
 * lists the components that match what has been typed, and inserts the chosen
 * one. Inside a component's tag it lists the props the tag doesn't have yet
 * and, within a prop's quotes, the values worth trying (`width="50%"`).
 */
export function useMdxCompletion(surface: EditorSurface, value: string) {
  const menuId = useId();
  // Where the caret is, or null when the editor has no caret or a selection (or isn't focused).
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
  function sync() {
    const { start, end } = surface.selection();
    const collapsed = start === end;
    const next = collapsed ? findTarget(surface.text(), start) : null;
    setCaret(collapsed ? start : null);
    if (next?.query !== target?.query) setActive(0);
    if (!next) setDismissed(null);
    if (next) setPosition(placeMenu(surface, next.start));
  }

  function accept(item: MdxCompletion) {
    if (!shown) return;
    const { text: inserted, caret: offset } = expandCompletion(item);
    surface.replace(shown.start, shown.end, inserted, offset);
    setCaret(shown.start + offset);
    // The next menu (a prop's values, after the prop) starts at its top, not where this one's highlight was.
    setActive(0);
  }

  function onKeyDown(event: EditorKeyEvent) {
    if (!shown || event.isComposing) return;
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
    /** Attributes for the editor, so assistive tech hears the menu as part of it. */
    aria: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? menuId : undefined,
      "aria-activedescendant": open ? optionId(menuId, items[activeIndex]) : undefined,
    },
    onKeyDown,
    onSelect: sync,
    onScroll: sync,
    onFocus: sync,
    onBlur: () => setCaret(null),
    sync,
  };
}
