import type { EditorView } from "@codemirror/view";
import { useMemo, type RefObject } from "react";
import type { EditorSurface } from "./editorSurface";

/**
 * The live editor as a surface, so the writing menus work in it as they do in the plain editor. The view is read
 * when asked (it is built after the first render, and not at all while another view of the note is showing), and
 * `box` is the element the menus are placed in: coordinates are given from its top left corner.
 */
export function useLiveSurface(view: RefObject<EditorView | null>, box: RefObject<HTMLElement | null>): EditorSurface {
  return useMemo<EditorSurface>(
    () => ({
      text: () => view.current?.state.doc.toString() ?? "",
      selection() {
        const range = view.current?.state.selection.main;
        return { start: range?.from ?? 0, end: range?.to ?? 0 };
      },
      replace(start, end, text, caret = text.length) {
        const editor = view.current;
        if (!editor) return;
        editor.dispatch({
          changes: { from: start, to: end, insert: text },
          // The new text's coordinates, so the caret can be put before the change as well as in or after it.
          ...(caret === null ? {} : { selection: { anchor: start + caret } }),
          scrollIntoView: true,
          userEvent: "input",
        });
      },
      setSelection(start, end) {
        view.current?.dispatch({ selection: { anchor: start, head: end } });
      },
      coordsAt(pos) {
        const editor = view.current;
        const rect = box.current?.getBoundingClientRect();
        // Measuring needs a layout engine, which a test's DOM does not have.
        let at: ReturnType<EditorView["coordsAtPos"]> = null;
        try {
          at = editor?.coordsAtPos(pos) ?? null;
        } catch {
          at = null;
        }
        if (!at || !rect) return { left: 0, top: 0, height: 0 };
        return { left: at.left - rect.left, top: at.top - rect.top, height: at.bottom - at.top };
      },
      box: () => ({ width: box.current?.clientWidth ?? 0, height: box.current?.clientHeight ?? 0 }),
      hasFocus: () => view.current !== null && view.current.contentDOM.ownerDocument.activeElement === view.current.contentDOM,
    }),
    [view, box],
  );
}
