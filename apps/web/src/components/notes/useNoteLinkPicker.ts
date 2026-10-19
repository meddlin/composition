import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { NOTE_MENU_HEIGHT_PX, noteOptionId } from "./NoteLinkMenu";
import { findNoteTrigger, linkTo, matchNotes } from "./noteLinks";
import type { Note } from "./types";
import { placeMenu, type Position } from "./useMdxCompletion";

/** Cmd+Shift+K on macOS, Ctrl+Shift+K elsewhere; `aria-keyshortcuts` says the same. */
export const NOTE_LINK_SHORTCUT = "Control+Shift+K Meta+Shift+K";

export function isNoteLinkShortcut(event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  return event.key.toLowerCase() === "k" && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

/** A picker opened by the shortcut: the text it will replace, and what has been typed to filter the notes. */
type Session = { start: number; end: number; label: string; query: string };

/**
 * Linking to another note from the editor's textarea, two ways. Typing `[[`
 * lists the notes that match what follows it; the shortcut does the same at the
 * caret, or over the selected words, which then become the link's text. The
 * chosen note goes in as `[title](note:id)`. `insert` swaps `[start, end)` for
 * `text` and puts the caret `caret` characters into it.
 */
export function useNoteLinkPicker(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
  notes: readonly Note[],
  currentNoteId: number,
  insert: (start: number, end: number, text: string, caret: number) => void,
) {
  const menuId = useId();
  // Where the caret is, or null when the textarea has no caret or a selection (or isn't focused).
  const [caret, setCaret] = useState<number | null>(null);
  const [position, setPosition] = useState<Position>({ left: 0 });
  const [active, setActive] = useState(0);
  // The `[[` the user waved away with Escape; it stays away until they start another link.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const trigger = useMemo(
    () => (session || caret === null ? null : findNoteTrigger(value, caret)),
    [session, value, caret],
  );
  const query = session ? session.query : (trigger?.query ?? "");
  const items = useMemo(() => matchNotes(notes, query, currentNoteId), [notes, query, currentNoteId]);
  const shownTrigger = trigger !== null && trigger.start !== dismissed && items.length > 0 ? trigger : null;
  const open = session !== null || shownTrigger !== null;
  const activeIndex = Math.max(0, Math.min(active, items.length - 1));

  /** Reads where the caret is now; call after anything that can move it or change the text. */
  function sync(el: HTMLTextAreaElement) {
    const collapsed = el.selectionStart === el.selectionEnd;
    // Clicking elsewhere, or changing the text, ends a picker the shortcut opened.
    if (session && (el.selectionStart !== session.start || el.selectionEnd !== session.end || el.value !== value)) {
      setSession(null);
    }
    const next = collapsed ? findNoteTrigger(el.value, el.selectionStart) : null;
    setCaret(collapsed ? el.selectionStart : null);
    if (next?.query !== trigger?.query) setActive(0);
    if (!next) setDismissed(null);
    if (next) setPosition(placeMenu(el, next.start, NOTE_MENU_HEIGHT_PX));
  }

  /** Opens the picker at the caret, or over the selection; the shortcut calls this. */
  function openPicker(el: HTMLTextAreaElement) {
    if (open) return;
    const { selectionStart: start, selectionEnd: end } = el;
    setSession({ start, end, label: el.value.slice(start, end), query: "" });
    setActive(0);
    setPosition(placeMenu(el, start, NOTE_MENU_HEIGHT_PX));
  }

  function accept(note: Note) {
    const el = textarea.current;
    if (!el) return;
    if (session) {
      const text = linkTo(note, session.label);
      insert(session.start, session.end, text, text.length);
      setSession(null);
    } else if (shownTrigger) {
      const text = linkTo(note);
      insert(shownTrigger.start, el.selectionStart, text, text.length);
      setCaret(shownTrigger.start + text.length);
    }
  }

  function close() {
    if (session) setSession(null);
    else if (shownTrigger) setDismissed(shownTrigger.start);
  }

  function setQuery(next: string) {
    if (!session) return;
    setSession({ ...session, query: next });
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (isNoteLinkShortcut(event)) {
      event.preventDefault(); // Keep the browser from claiming it (Firefox opens its web console on Ctrl+Shift+K).
      if (open) close();
      else openPicker(event.currentTarget);
      return;
    }
    if (!open) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (items.length > 0) setActive((activeIndex + 1) % items.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (items.length > 0) setActive((activeIndex - 1 + items.length) % items.length);
        return;
      case "Enter":
      case "Tab":
        event.preventDefault();
        if (items.length > 0) accept(items[activeIndex]);
        return;
      case "Escape":
        event.preventDefault();
        close();
        return;
    }
    // The shortcut's picker has no text in the note to type into, so it takes the keys itself.
    if (!session || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      setQuery(session.query.slice(0, -1));
    } else if (event.key.length === 1) {
      event.preventDefault();
      setQuery(session.query + event.key);
    }
  }

  const style: CSSProperties = { left: position.left, top: position.top, bottom: position.bottom };

  return {
    open,
    menu: {
      id: menuId,
      notes: items,
      active: activeIndex,
      style,
      filter: session ? { query: session.query, label: session.label } : undefined,
      onPick: accept,
      onHover: setActive,
    },
    /** Props for the textarea, so assistive tech hears the menu as part of it. */
    textareaProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? menuId : undefined,
      "aria-activedescendant": open && items.length > 0 ? noteOptionId(menuId, items[activeIndex]) : undefined,
      "aria-keyshortcuts": NOTE_LINK_SHORTCUT,
      onKeyDown,
      onSelect: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onScroll: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onFocus: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onBlur: () => {
        setCaret(null);
        setSession(null);
      },
    },
    sync,
  };
}
