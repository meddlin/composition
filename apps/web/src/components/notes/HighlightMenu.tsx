import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { HighlightColor } from "./mdx/highlightColors";

export const HIGHLIGHT_MENU_WIDTH_PX = 192;

/** What the menu offers: a colour to highlight with, or taking the highlight off. */
export type HighlightChoice = HighlightColor | "remove";

export type HighlightItem = { choice: HighlightChoice; label: string; key: string };

type Props = {
  id: string;
  items: HighlightItem[];
  active: number;
  /** Where to put it within the editor pane. */
  style: CSSProperties;
  onPick: (choice: HighlightChoice) => void;
  onHover: (index: number) => void;
};

export const highlightOptionId = (menuId: string, choice: HighlightChoice) => `${menuId}-${choice}`;

/**
 * The colours to highlight the selection with, shown beside it. Like the completion menu, the
 * textarea keeps focus the whole time (it points here with aria-activedescendant), so the menu
 * only needs to handle the mouse; the keyboard is handled in useHighlightMenu.
 */
export function HighlightMenu({ id, items, active, style, onPick, onHover }: Props) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Highlight color"
      style={{ ...style, width: HIGHLIGHT_MENU_WIDTH_PX }}
      className="absolute z-10 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, index) => (
        <div
          key={item.choice}
          id={highlightOptionId(id, item.choice)}
          role="option"
          aria-selected={index === active}
          aria-keyshortcuts={item.key}
          // Keep focus (and the selection) in the textarea.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item.choice);
          }}
          onMouseMove={() => onHover(index)}
          className={cn(
            "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            item.choice === "remove" && "mt-1 border-t pt-2",
            index === active && "bg-accent text-accent-foreground",
          )}
        >
          {item.choice === "remove" ? (
            <span aria-hidden className="size-4 shrink-0 rounded-sm border border-dashed" />
          ) : (
            <span aria-hidden data-color={item.choice} className="md-mark size-4 shrink-0 rounded-sm border" />
          )}
          <span className="flex-1">{item.label}</span>
          <kbd aria-hidden className="font-mono text-xs text-muted-foreground">
            {item.key}
          </kbd>
        </div>
      ))}
    </div>
  );
}
