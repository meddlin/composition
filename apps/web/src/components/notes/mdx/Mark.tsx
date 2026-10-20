import type { ReactNode } from "react";
import { highlightColorOf } from "./highlightColors";

/**
 * Highlighted text, like a highlighter pen: `<Mark color="green">text</Mark>`, inline, with Markdown
 * allowed inside. `color` is one of HIGHLIGHT_COLORS; anything else is yellow. The tint comes from
 * the active colour scheme (`.note-mark` in globals.css) and sits behind the text, which keeps its
 * own colour.
 */
export function Mark({ color, children }: { color?: string; children?: ReactNode }) {
  return (
    <mark className="note-mark" data-color={highlightColorOf(color)}>
      {children}
    </mark>
  );
}
