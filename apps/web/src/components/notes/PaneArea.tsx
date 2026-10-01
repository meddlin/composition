"use client";

import { Fragment, useRef } from "react";
import { NotePane } from "./NotePane";
import { dragPaneSizes, MIN_PANE_WIDTH, type DropZone, type Pane, type PaneView } from "./panes";
import { ResizeHandle } from "./ResizeHandle";
import type { Note } from "./types";

type Props = {
  panes: Pane[];
  notes: Note[];
  focusedId: number | null;
  /** The editor's share of each pane; one setting for all of them. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: () => void;
  onFocus: (noteId: number) => void;
  onViewChange: (noteId: number, view: PaneView) => void;
  onClose: (noteId: number) => void;
  onChange: (noteId: number, content: string) => void;
  onDropNote: (noteId: number, targetId: number, zone: DropZone) => void;
  onResizePanes: (sizes: number[]) => void;
};

/** The open notes in a row, side by side, with a divider to drag between each pair. */
export function PaneArea({
  panes,
  notes,
  focusedId,
  ratio,
  onRatioChange,
  onRatioCommit,
  onFocus,
  onViewChange,
  onClose,
  onChange,
  onDropNote,
  onResizePanes,
}: Props) {
  const row = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ sizes: [] as number[], width: 0 });
  const noteById = new Map(notes.map((note) => [note.id, note]));

  return (
    // Panes never shrink below a readable width; past that the row scrolls.
    <div ref={row} className="flex min-w-0 flex-1 overflow-x-auto">
      {panes.map((pane, index) => {
        const note = noteById.get(pane.noteId);
        if (!note) return null;
        const before = panes[index - 1];
        return (
          <Fragment key={pane.noteId}>
            {before && (
              <ResizeHandle
                label={`Resize panes ${index} and ${index + 1}`}
                // The left pane's share of the two panes this divider sits between.
                valueNow={Math.round((100 * before.size) / (before.size + pane.size))}
                valueMin={0}
                valueMax={100}
                onResizeStart={() => {
                  dragStart.current = {
                    sizes: panes.map((p) => p.size),
                    width: row.current?.getBoundingClientRect().width ?? 0,
                  };
                }}
                onResize={(dx) =>
                  onResizePanes(dragPaneSizes(dragStart.current.sizes, index - 1, dx, dragStart.current.width))
                }
                onResizeEnd={() => {}}
              />
            )}
            <NotePane
              note={note}
              focused={pane.noteId === focusedId}
              view={pane.view}
              style={{ flex: `${pane.size} 1 0%`, minWidth: MIN_PANE_WIDTH }}
              ratio={ratio}
              onRatioChange={onRatioChange}
              onRatioCommit={onRatioCommit}
              onViewChange={(view) => onViewChange(pane.noteId, view)}
              onFocus={() => onFocus(pane.noteId)}
              onClose={() => onClose(pane.noteId)}
              onChange={(content) => onChange(pane.noteId, content)}
              onDropNote={(noteId, zone) => onDropNote(noteId, pane.noteId, zone)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
