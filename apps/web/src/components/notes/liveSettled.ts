import type { EditorState } from "@codemirror/state";
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { useCallback, useRef, useSyncExternalStore } from "react";
import { REDRAW_DELAY } from "./liveBlocks";

/**
 * What a drawn block that needs the whole note (`<Toc>`: its headings; `<Footnotes>`: its footnotes) reads it
 * through. It is read again once typing has paused (`REDRAW_DELAY`, as a block being edited is redrawn), and only
 * while such a block is drawn, so typing in a long note does not re-read it on every key.
 */
export const liveSettledNote = ViewPlugin.fromClass(
  class implements PluginValue {
    /** Bumped once the note has changed and typing has paused. */
    version = 0;
    private readonly listeners = new Set<() => void>();
    private timer: ReturnType<typeof setTimeout> | null = null;

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      if (this.listeners.size === 0) {
        // Nothing drawn reads it: the next drawing reads the note as it is then.
        this.version++;
        return;
      }
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.version++;
        for (const listener of this.listeners) listener();
      }, REDRAW_DELAY);
    }

    readonly subscribe = (listener: () => void) => {
      this.listeners.add(listener);
      return () => void this.listeners.delete(listener);
    };

    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);

/**
 * `read(state)` of the editor's note, read again after each pause in typing. It returns a string (JSON, say), so a
 * reading that comes out the same keeps the drawing as it is.
 */
export function useSettledNote(view: EditorView, read: (state: EditorState) => string): string {
  const plugin = view.plugin(liveSettledNote);
  const cache = useRef<{ version: number; value: string } | null>(null);
  const subscribe = useCallback((listener: () => void) => plugin?.subscribe(listener) ?? (() => {}), [plugin]);
  const snapshot = () => {
    const version = plugin?.version ?? 0;
    if (cache.current?.version !== version) cache.current = { version, value: read(view.state) };
    return cache.current.value;
  };
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
