"use client";

import { XIcon } from "lucide-react";
import { useId, useRef, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttachmentsSlot } from "./AttachmentsSlot";
import { PANE_DRAG_TYPE } from "./dragTypes";
import { DropOverlay } from "./DropOverlay";
import { EditorTabs } from "./EditorTabs";
import { MarkdownEditor } from "./MarkdownEditor";
import { SIDE_BY_SIDE_MIN_WIDTH, shownView, type DropZone, type PaneView } from "./panes";
import { noteTitle, type Note } from "./types";
import { useMinWidth } from "./useMinWidth";
import { useNoteDrop } from "./useNoteDrop";

type Props = {
  note: Note;
  /** Whether it is the pane that sidebar picks open into; only worth showing when there are several. */
  focused: boolean;
  /** What the user picked to see of the note; the pane may show less if it is too narrow. */
  view: PaneView;
  style?: CSSProperties;
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: () => void;
  onViewChange: (view: PaneView) => void;
  onFocus: () => void;
  onClose: () => void;
  onChange: (content: string) => void;
  onDropNote: (noteId: number, zone: DropZone) => void;
};

/**
 * One open note: a header to drag it by or close it, tabs to see its editor,
 * its preview, or both beside each other, and that view of it. In the desktop
 * app the note's attached files are listed below. Dragging another
 * note over it offers to open that note next to this one or in its place.
 */
export function NotePane({
  note,
  focused,
  view,
  style,
  ratio,
  onRatioChange,
  onRatioCommit,
  onViewChange,
  onFocus,
  onClose,
  onChange,
  onDropNote,
}: Props) {
  const drop = useNoteDrop({ edges: true, onDrop: onDropNote });
  const title = noteTitle(note);

  const section = useRef<HTMLElement>(null);
  const canSplit = useMinWidth(section, SIDE_BY_SIDE_MIN_WIDTH);
  const idBase = useId();

  return (
    <section
      ref={section}
      aria-label={title}
      aria-current={focused ? "true" : undefined}
      style={style}
      className="relative flex min-h-0 min-w-0 flex-col"
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
      {...drop.handlers}
    >
      <header
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PANE_DRAG_TYPE, String(note.id));
          e.dataTransfer.effectAllowed = "move";
        }}
        title="Drag to move this note beside another"
        className="flex shrink-0 cursor-grab items-center gap-2 border-b py-1 pl-4 pr-2 active:cursor-grabbing"
      >
        <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", !focused && "text-muted-foreground")}>
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={`Close ${title}`}
          title="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <XIcon />
        </Button>
      </header>
      <EditorTabs idBase={idBase} view={shownView(view, canSplit)} canSplit={canSplit} onChange={onViewChange} />
      <MarkdownEditor
        idBase={idBase}
        view={shownView(view, canSplit)}
        noteId={note.id}
        value={note.content}
        onChange={onChange}
        ratio={ratio}
        onRatioChange={onRatioChange}
        onRatioCommit={onRatioCommit}
      />
      <AttachmentsSlot key={note.id} noteId={note.id} />
      {drop.zone && <DropOverlay zone={drop.zone} />}
    </section>
  );
}
