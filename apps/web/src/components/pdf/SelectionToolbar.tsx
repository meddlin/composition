"use client";

import { HighlighterIcon, StrikethroughIcon, UnderlineIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { PDF_MARK_COLORS, type PdfMarkKind } from "@/lib/composition/pdfMarkup";
import { cn } from "@/lib/utils";
import { paintFor } from "./pdfGeometry";

export type TextMarkKind = Exclude<PdfMarkKind, "text" | "ink">;

const COLOR_NAMES: Record<string, string> = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", orange: "Orange" };

/**
 * The little bar that appears over text selected in a page: the five colors, and highlight, underline or strikethrough.
 * It is placed by the selection's rectangle on the screen, above it, or below when there is no room above. Pressing a
 * button in it must not take the selection away, which a mouse press would by moving the focus, so presses are stopped.
 */
export function SelectionToolbar({ anchor, color, onColor, onMark }: { anchor: { x: number; top: number; bottom: number }; color: string; onColor: (color: string) => void; onMark: (kind: TextMarkKind) => void }) {
  const above = anchor.top > 56;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Mark the selected text"
      onMouseDown={(event) => event.preventDefault()}
      style={{ position: "fixed", left: Math.max(8, anchor.x - 120), top: above ? anchor.top - 44 : anchor.bottom + 8, zIndex: 50 }}
      className="flex items-center gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {PDF_MARK_COLORS.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`Color: ${COLOR_NAMES[name]}`}
          aria-pressed={color === name}
          onClick={() => onColor(name)}
          style={{ background: paintFor(name).fill, borderColor: paintFor(name).line }}
          className={cn("size-5 rounded-full border", color === name && "ring-2 ring-foreground ring-offset-1")}
        />
      ))}
      <div className="mx-0.5 h-5 w-px bg-border" />
      <Button variant="ghost" size="icon-sm" aria-label="Highlight" title="Highlight (Ctrl/Cmd+Shift+H)" onClick={() => onMark("highlight")}>
        <HighlighterIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Underline" title="Underline (Ctrl/Cmd+Shift+U)" onClick={() => onMark("underline")}>
        <UnderlineIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Strikethrough" title="Strikethrough (Ctrl/Cmd+Shift+S)" onClick={() => onMark("strikethrough")}>
        <StrikethroughIcon />
      </Button>
    </div>,
    document.body,
  );
}
