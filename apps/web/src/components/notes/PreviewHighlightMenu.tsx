import { useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyText } from "./clipboard";
import type { HighlightChoice } from "./HighlightMenu";
import { removeHighlight, type TextRange } from "./highlightText";
import { lastHighlightColor } from "./lastHighlightColor";
import { HIGHLIGHT_COLORS, type HighlightColor } from "./mdx/highlightColors";
import { sourceRangeOf } from "./previewSource";

/** What a right-click found: where in the note the highlight would go, or why it can't. */
type Target = {
  /** Offsets into the whole note, frontmatter included; null when `reason` says why not. */
  range: TextRange | null;
  reason: string | null;
  canRemove: boolean;
  /** The text to copy. */
  text: string;
};

const label = (color: HighlightColor) => color[0].toUpperCase() + color.slice(1);

function Swatch({ color }: { color: HighlightColor }) {
  return <span aria-hidden data-color={color} className="md-mark size-4 shrink-0 rounded-sm border" />;
}

type Props = {
  /** The preview's own box: the element the selection is read in. */
  boxRef: RefObject<HTMLDivElement | null>;
  className?: string;
  /** The whole note, and the part of it the preview was rendered from, which is that less its frontmatter. */
  text: string;
  body: string;
  onApply: (choice: HighlightChoice, range: TextRange) => void;
  children: ReactNode;
};

/**
 * The preview, with a right-click menu for highlighting what is selected in it: "Highlight text" in
 * the colour used last, a submenu of the colours, "Remove highlight" over an existing one, and Copy.
 *
 * The menu is only taken over when there is something to offer: a selection in the preview, or a
 * right-click on a highlight. Anywhere else the browser's (or the desktop app's) own menu appears.
 * Taking it over means Copy has to be here too. The target is worked out when the menu opens, so it
 * does not depend on the selection surviving the click on an item.
 */
export function PreviewHighlightMenu({ boxRef, className, text, body, onApply, children }: Props) {
  const [target, setTarget] = useState<Target | null>(null);

  function inspect(event: MouseEvent<HTMLDivElement>) {
    const root = boxRef.current;
    if (!root) return event.stopPropagation();

    const selection = window.getSelection();
    let range: Range | null = null;
    let copyText = "";
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed && root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      range = selection.getRangeAt(0);
      copyText = selection.toString();
    } else {
      const mark = event.target instanceof Element ? event.target.closest("mark.note-mark") : null;
      if (mark && root.contains(mark)) {
        range = root.ownerDocument.createRange();
        range.selectNodeContents(mark);
        copyText = mark.textContent ?? "";
      }
    }
    // Nothing of ours to offer: don't open, and the event carries on to the browser's own menu.
    if (!range) return event.stopPropagation();

    const found = sourceRangeOf(root, range, body);
    if (!found.ok) return setTarget({ range: null, reason: found.reason, canRemove: false, text: copyText });
    const offset = text.length - body.length;
    const whole = { start: offset + found.start, end: offset + found.end };
    setTarget({ range: whole, reason: null, canRemove: removeHighlight(text, whole).ok, text: copyText });
  }

  const last = lastHighlightColor();
  const apply = (choice: HighlightChoice) => {
    const range = target?.range;
    // The edit needs the editor to take focus (that is what keeps it undoable), and the menu holds
    // focus until it has closed, which happens once this handler has returned.
    if (range) window.setTimeout(() => onApply(choice, range), 0);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={boxRef} data-note-preview="" className={className} onContextMenuCapture={inspect}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        // The focus would go back to the preview, which scrolls it; there is nothing there to focus.
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="w-56"
      >
        <ContextMenuItem disabled={!target?.range} onSelect={() => apply(last)}>
          <Swatch color={last} />
          Highlight text
        </ContextMenuItem>
        {target?.reason && <ContextMenuLabel className="whitespace-normal">{target.reason}</ContextMenuLabel>}
        {target?.range && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Highlight color</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {HIGHLIGHT_COLORS.map((color) => (
                <ContextMenuItem key={color} onSelect={() => apply(color)}>
                  <Swatch color={color} />
                  {label(color)}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {target?.canRemove && <ContextMenuItem onSelect={() => apply("remove")}>Remove highlight</ContextMenuItem>}
        {target?.text && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void copyText(target.text)}>Copy</ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
