import { useId, useMemo, useState, type CSSProperties } from "react";
import { placeMenu, type EditorKeyEvent, type EditorSurface, type Position } from "./editorSurface";
import { NOTE_MENU_HEIGHT_PX, noteOptionId } from "./NoteLinkMenu";
import { findNoteTrigger, linkTo, matchNotes } from "./noteLinks";
import type { Note } from "./types";

/** Cmd+Shift+K on macOS, Ctrl+Shift+K elsewhere; `aria-keyshortcuts` says the same. */
export const NOTE_LINK_SHORTCUT = "Control+Shift+K Meta+Shift+K";

export function isNoteLinkShortcut(event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  return event.key.toLowerCase() === "k" && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

/** A picker opened by the shortcut: the text it will replace, and what has been typed to filter the notes. */
type Session = { start: number; end: number; label: string; query: string };

/**
 * Linking to another note from the editor, two ways. Typing `[[`
 * lists the notes that match what follows it; the shortcut does the same at the
 * caret, or over the selected words, which then become the link's text. The
 * chosen note goes in as `[title](note:id)`.
 */
export function useNoteLinkPicker(surface: EditorSurface, value: string, notes: readonly Note[], currentNoteId: number) {
  const menuId = useId();
  // Where the caret is, or null when the editor has no caret or a selection (or isn't focused).
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
  function sync() {
    const { start, end } = surface.selection();
    const text = surface.text();
    const collapsed = start === end;
    // Clicking elsewhere, or changing the text, ends a picker the shortcut opened.
    if (session && (start !== session.start || end !== session.end || text !== value)) {
      setSession(null);
    }
    const next = collapsed ? findNoteTrigger(text, start) : null;
    setCaret(collapsed ? start : null);
    if (next?.query !== trigger?.query) setActive(0);
    if (!next) setDismissed(null);
    if (next) setPosition(placeMenu(surface, next.start, NOTE_MENU_HEIGHT_PX));
  }

  /** Opens the picker at the caret, or over the selection; the shortcut calls this. */
  function openPicker() {
    if (open) return;
    const { start, end } = surface.selection();
    setSession({ start, end, label: surface.text().slice(start, end), query: "" });
    setActive(0);
    setPosition(placeMenu(surface, start, NOTE_MENU_HEIGHT_PX));
  }

  function accept(note: Note) {
    if (session) {
      const text = linkTo(note, session.label);
      surface.replace(session.start, session.end, text, text.length);
      setSession(null);
    } else if (shownTrigger) {
      const text = linkTo(note);
      surface.replace(shownTrigger.start, surface.selection().start, text, text.length);
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

  function onKeyDown(event: EditorKeyEvent) {
    if (event.isComposing) return;
    if (isNoteLinkShortcut(event)) {
      event.preventDefault(); // Keep the browser from claiming it (Firefox opens its web console on Ctrl+Shift+K).
      if (open) close();
      else openPicker();
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
    /** Attributes for the editor, so assistive tech hears the menu as part of it. */
    aria: {
      "aria-controls": open ? menuId : undefined,
      "aria-activedescendant": open && items.length > 0 ? noteOptionId(menuId, items[activeIndex]) : undefined,
    },
    onKeyDown,
    onSelect: sync,
    onScroll: sync,
    onFocus: sync,
    onBlur: () => {
      setCaret(null);
      setSession(null);
    },
    sync,
  };
}
