import { startTransition, useRef, useState } from "react";
import { saveLayout } from "@/lib/composition/client";
import { clampEditorRatio, clampSidebarWidth, type Layout } from "@/lib/composition/layout";

/**
 * Column sizes for the workspace. Changes apply live while dragging and are
 * persisted once, when the drag ends.
 */
export function useLayout(initial: Layout) {
  const [layout, setLayout] = useState(initial);
  // Mirrors `layout` so commit() on pointer-up never reads a stale closure.
  const latest = useRef(layout);
  const sidebarStart = useRef(layout.sidebarWidth);

  function update(patch: Partial<Layout>) {
    latest.current = { ...latest.current, ...patch };
    setLayout(latest.current);
  }

  function commit() {
    const current = latest.current;
    startTransition(async () => {
      await saveLayout(current);
    });
  }

  return {
    sidebarWidth: layout.sidebarWidth,
    editorRatio: layout.editorRatio,
    setEditorRatio: (editorRatio: number) => update({ editorRatio: clampEditorRatio(editorRatio) }),
    commit,
    // Handlers for the nav | editor divider's ResizeHandle.
    sidebarResize: {
      onResizeStart: () => {
        sidebarStart.current = latest.current.sidebarWidth;
      },
      onResize: (dxPx: number) =>
        update({ sidebarWidth: clampSidebarWidth(sidebarStart.current + dxPx) }),
      onResizeEnd: commit,
    },
  };
}
