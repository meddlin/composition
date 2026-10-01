import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { MdxCompletion } from "./mdx/completions";

export const MENU_WIDTH_PX = 288;

type Props = {
  id: string;
  items: MdxCompletion[];
  active: number;
  /** Where to put it within the editor pane. */
  style: CSSProperties;
  onPick: (item: MdxCompletion) => void;
  onHover: (index: number) => void;
};

export const optionId = (menuId: string, item: MdxCompletion) => `${menuId}-${item.name}`;

/**
 * The list of components shown at the caret after a `<`. The textarea keeps
 * focus the whole time (it points here with aria-activedescendant), so the
 * menu only needs to handle the mouse.
 */
export function MdxCompletionMenu({ id, items, active, style, onPick, onHover }: Props) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="MDX components"
      style={{ ...style, width: MENU_WIDTH_PX }}
      className="absolute z-10 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.map((item, index) => (
        <div
          key={item.name}
          id={optionId(id, item)}
          role="option"
          aria-selected={index === active}
          // Keep focus (and the caret) in the textarea.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
          onMouseMove={() => onHover(index)}
          className={cn("cursor-default rounded-sm px-2 py-1.5", index === active && "bg-accent text-accent-foreground")}
        >
          <div className="font-mono text-sm">{`<${item.name}>`}</div>
          <div className="text-xs text-muted-foreground">{item.description}</div>
        </div>
      ))}
    </div>
  );
}
