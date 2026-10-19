"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { PANE_DRAG_TYPE } from "./dragTypes";
import { DropOverlay } from "./DropOverlay";
import { EditorTabs } from "./EditorTabs";
import { FindBar } from "./FindBar";
import type { FindOptions } from "./findMatches";
import { MarkdownEditor, type FindState } from "./MarkdownEditor";
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
 * its preview, or both beside each other, and that view of it. Ctrl/Cmd+F (or the
 * magnifier in the header) opens a find bar that highlights a word or phrase in
 * this note alone, separate from the app-wide search. In the desktop
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

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<FindOptions>({ matchCase: false, wholeWord: false });
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);

  function focusFind() {
    findInput.current?.focus();
    findInput.current?.select();
  }

  function openFind() {
    // A word picked out in the editor is most likely the one to look for.
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && section.current?.contains(active)) {
      const picked = active.value.slice(active.selectionStart, active.selectionEnd);
      if (picked !== "" && picked.length <= 200 && !/[\r\n]/.test(picked)) {
        setQuery(picked);
        setCurrent(0);
      }
    }
    setFindOpen(true);
    focusFind(); // already open; a find bar opening now is focused by the effect below
  }

  function closeFind() {
    if (document.activeElement === findInput.current) section.current?.querySelector("textarea")?.focus();
    setFindOpen(false);
  }

  useEffect(() => {
    if (!findOpen) return;
    findInput.current?.focus();
    findInput.current?.select();
  }, [findOpen]);

  // Only the focused pane answers, so with several notes open Ctrl/Cmd+F searches the one being worked in.
  useEffect(() => {
    if (!focused) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault(); // Keep the browser's own find from opening over it.
      openFind();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const find = useMemo<FindState | undefined>(
    () => (findOpen ? { query, options, current, onCount: setCount } : undefined),
    [findOpen, query, options, current],
  );
  const shownCurrent = count === 0 ? 0 : Math.min(current, count - 1);

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
          onClick={() => (findOpen ? closeFind() : openFind())}
          aria-label="Find in note"
          aria-pressed={findOpen}
          title="Find in note (Ctrl/Cmd+F)"
          className="text-muted-foreground hover:text-foreground"
        >
          <SearchIcon />
        </Button>
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
      {findOpen && (
        <FindBar
          query={query}
          options={options}
          count={count}
          current={shownCurrent}
          inputRef={findInput}
          onQueryChange={(next) => {
            setQuery(next);
            setCurrent(0);
          }}
          onOptionsChange={(next) => {
            setOptions(next);
            setCurrent(0);
          }}
          onStep={(delta) => count > 0 && setCurrent((shownCurrent + delta + count) % count)}
          onClose={closeFind}
        />
      )}
      <MarkdownEditor
        find={find}
        idBase={idBase}
        view={shownView(view, canSplit)}
        noteId={note.id}
        value={note.content}
        onChange={onChange}
        ratio={ratio}
        onRatioChange={onRatioChange}
        onRatioCommit={onRatioCommit}
      />
      <AttachmentsPanel key={note.id} noteId={note.id} />
      {drop.zone && <DropOverlay zone={drop.zone} />}
    </section>
  );
}
