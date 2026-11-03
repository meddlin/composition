import type { EditorKeyEvent, EditorSurface } from "./editorSurface";
import type { HighlightChoice } from "./HighlightMenu";
import type { TextRange } from "./highlightText";
import type { Note } from "./types";
import { useHighlightMenu } from "./useHighlightMenu";
import { useImagePicker } from "./useImagePicker";
import { useMdxCompletion } from "./useMdxCompletion";
import { useNoteLinkPicker } from "./useNoteLinkPicker";

type Options = {
  surface: EditorSurface;
  /** The note's text as React last rendered it. */
  value: string;
  /** Every note, for the picker that links to one. */
  notes: readonly Note[];
  /** The note being edited, which the picker leaves out. */
  noteId: number;
  /** Does what the highlight menu asked for (see `useHighlightMenu`). */
  applyHighlight: (choice: HighlightChoice, range: TextRange) => void;
};

/**
 * The editor's writing menus: the `<` completion, the image picker, the note-link picker and the highlight menu.
 * They are about whichever editor is showing (the `surface`), and this is the one place that knows how they share
 * it: which gets a key first, which attributes the editor shows for the open menu, and what each hears about the
 * caret moving, the editor scrolling or losing focus. The editor calls the `on…` functions from its own events
 * and draws the menus that are `open`.
 */
export function useEditorFeatures({ surface, value, notes, noteId, applyHighlight }: Options) {
  const completion = useMdxCompletion(surface, value);
  const imagePicker = useImagePicker(surface, value);
  const noteLinkPicker = useNoteLinkPicker(surface, value, notes, noteId);
  const highlightMenu = useHighlightMenu(surface, applyHighlight);

  return {
    completion,
    imagePicker,
    noteLinkPicker,
    highlightMenu,

    /** For the editor: the open menu is what it is pointing at (the first that has one open). */
    aria: {
      "aria-autocomplete": completion.aria["aria-autocomplete"],
      "aria-controls":
        imagePicker.aria["aria-controls"] ??
        completion.aria["aria-controls"] ??
        noteLinkPicker.aria["aria-controls"] ??
        highlightMenu.aria["aria-controls"],
      "aria-activedescendant":
        imagePicker.aria["aria-activedescendant"] ??
        completion.aria["aria-activedescendant"] ??
        noteLinkPicker.aria["aria-activedescendant"] ??
        highlightMenu.aria["aria-activedescendant"],
    },

    /** A key press: each menu in turn, until one handles it (calls `preventDefault`). */
    onKeyDown(event: EditorKeyEvent) {
      // The menus take Tab while one is open. Shift+Tab stays free so the keyboard can still leave the editor.
      // The image picker comes first: it swallows every key while open, which a menu opened by typing must not see.
      if (imagePicker.open || !noteLinkPicker.open) imagePicker.onKeyDown(event);
      if (event.defaultPrevented) return;
      noteLinkPicker.onKeyDown(event);
      if (event.defaultPrevented) return;
      completion.onKeyDown(event);
      if (event.defaultPrevented) return;
      highlightMenu.onKeyDown(event);
    },

    /** The text changed (typing): the menus that open from what has been typed look again. */
    onChange() {
      completion.sync();
      noteLinkPicker.sync();
    },
    /** The caret or selection moved. */
    onSelect() {
      imagePicker.onSelect();
      completion.onSelect();
      noteLinkPicker.onSelect();
      highlightMenu.onSelect();
    },
    onFocus() {
      completion.onFocus();
      noteLinkPicker.onFocus();
    },
    onBlur() {
      imagePicker.onBlur();
      completion.onBlur();
      noteLinkPicker.onBlur();
      highlightMenu.onBlur();
    },
    onScroll() {
      imagePicker.onScroll();
      completion.onScroll();
      noteLinkPicker.onScroll();
      highlightMenu.onScroll();
    },
  };
}
