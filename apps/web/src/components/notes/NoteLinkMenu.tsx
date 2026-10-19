import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { MENU_WIDTH_PX } from "./MdxCompletionMenu";
import { noteTitle, type Note } from "./types";

/** Roughly the tallest the menu gets: its header and a full list. */
export const NOTE_MENU_HEIGHT_PX = 300;

type Props = {
  id: string;
  notes: Note[];
  active: number;
  /** Where to put it within the editor pane. */
  style: CSSProperties;
  /**
   * Set when the menu was opened with a shortcut rather than by typing `[[`: it
   * then shows what has been typed to filter by (there is no text in the note
   * to show it), and the words the link will carry.
   */
  filter?: { query: string; label: string };
  onPick: (note: Note) => void;
  onHover: (index: number) => void;
};

export const noteOptionId = (menuId: string, note: Note) => `${menuId}-${note.id}`;

/**
 * The list of notes shown at the caret to link to. The textarea keeps focus the
 * whole time (it points here with aria-activedescendant), so the menu only
 * needs to handle the mouse.
 */
export function NoteLinkMenu({ id, notes, active, style, filter, onPick, onHover }: Props) {
  return (
    <div
      style={{ ...style, width: MENU_WIDTH_PX }}
      className="absolute z-10 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {filter && (
        <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">
          {filter.label ? `Link “${filter.label}” to: ` : "Link to: "}
          <span className="text-foreground">{filter.query || "type to filter"}</span>
        </div>
      )}
      <div id={id} role="listbox" aria-label="Notes">
        {notes.map((note, index) => (
          <div
            key={note.id}
            id={noteOptionId(id, note)}
            role="option"
            aria-selected={index === active}
            // Keep focus (and the caret) in the textarea.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(note);
            }}
            onMouseMove={() => onHover(index)}
            className={cn(
              "cursor-default truncate rounded-sm px-2 py-1.5 text-sm",
              index === active && "bg-accent text-accent-foreground",
            )}
          >
            {noteTitle(note)}
          </div>
        ))}
      </div>
      {notes.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching notes</div>}
    </div>
  );
}
