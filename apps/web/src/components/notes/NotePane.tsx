"use client";

import { ImageIcon, MessageSquareIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { parse, withHeaderImage } from "@/lib/composition/frontmatter";
import { cn } from "@/lib/utils";
import { AssistantPanel } from "./AssistantPanel";
import { DOCK_DEFAULT_WIDTH, dockLayout, dragDockWidth } from "./assistantDock";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { PANE_DRAG_TYPE } from "./dragTypes";
import { DropOverlay } from "./DropOverlay";
import { EditorTabs } from "./EditorTabs";
import { FindBar } from "./FindBar";
import type { FindOptions } from "./findMatches";
import { HeaderImageDialog, type HeaderImageChoice } from "./HeaderImageDialog";
import { MarkdownEditor, type FindState } from "./MarkdownEditor";
import { SIDE_BY_SIDE_MIN_WIDTH, shownView, stepView, type DropZone, type PaneView } from "./panes";
import { readPaneSelection } from "./paneSelection";
import { ResizeHandle } from "./ResizeHandle";
import { noteTitle, type Note } from "./types";
import { useElementWidth } from "./useElementWidth";
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
  /** Every note, so the editor can offer them to link to. */
  notes: readonly Note[];
  /** A link in the preview was followed; `beside` asks for the note next to this one. */
  onOpenNote: (noteId: number, beside: boolean) => void;
  /** An answer from the AI helper to make into a separate new note. */
  onNewNoteFromText: (text: string) => void;
};

/**
 * One open note: a header to drag it by or close it, tabs to see its editor,
 * its preview, or both beside each other, and that view of it. Ctrl/Cmd+F (or the
 * magnifier in the header) opens a find bar that highlights a word or phrase in
 * this note alone, separate from the app-wide search. Ctrl/Cmd+\ (or Cmd+Ctrl+Left/Right) switches the tab. In the desktop
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
  notes,
  onOpenNote,
  onNewNoteFromText,
}: Props) {
  const drop = useNoteDrop({ edges: true, onDrop: onDropNote });
  const title = noteTitle(note);

  const section = useRef<HTMLElement>(null);
  // Whether the editor and preview fit beside each other is about the note's own column, which the AI helper's
  // dock takes room from.
  const noteColumn = useRef<HTMLDivElement>(null);
  const canSplit = useMinWidth(noteColumn, SIDE_BY_SIDE_MIN_WIDTH);
  const paneWidth = useElementWidth(section);

  const [assistantOpen, setAssistantOpen] = useState(false);
  const [wantedDockWidth, setWantedDockWidth] = useState(DOCK_DEFAULT_WIDTH);
  const dockDragStart = useRef(DOCK_DEFAULT_WIDTH);
  const dock = dockLayout(paneWidth, wantedDockWidth);
  const dockOver = assistantOpen && dock.mode === "over";
  const idBase = useId();

  const [headerImageOpen, setHeaderImageOpen] = useState(false);
  const [fm] = useMemo(() => parse(note.content), [note.content]);
  const header = useMemo<HeaderImageChoice | null>(
    () => (fm?.headerImage ? { image: fm.headerImage, layout: fm.headerImageLayout ?? "full" } : null),
    [fm],
  );

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

  // Ctrl/Cmd+Shift+L opens or closes the AI helper in the focused pane; opening puts the cursor in its question box.
  useEffect(() => {
    if (!focused) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "l" || !event.shiftKey || event.altKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      toggleAssistant();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function toggleAssistant() {
    if (assistantOpen) {
      setAssistantOpen(false);
      requestAnimationFrame(() => section.current?.querySelector("textarea")?.focus());
    } else {
      setAssistantOpen(true);
      requestAnimationFrame(() => section.current?.querySelector<HTMLElement>('[aria-label="Ask about this note"]')?.focus());
    }
  }

  // Switching the focused pane's view: Ctrl/Cmd+\ steps on through Markdown, Preview and Split;
  // Cmd+Ctrl+Left/Right (macOS) step back and on. `\` is matched on the physical key so it works
  // on any layout that has one; Alt is left out as AltGr types `\` on some layouts.
  useEffect(() => {
    if (!focused) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.shiftKey) return;
      let delta: 1 | -1;
      if (event.code === "Backslash" && (event.metaKey || event.ctrlKey)) delta = 1;
      else if (event.metaKey && event.ctrlKey && event.key === "ArrowRight") delta = 1;
      else if (event.metaKey && event.ctrlKey && event.key === "ArrowLeft") delta = -1;
      else return;
      event.preventDefault();
      const next = stepView(shownView(view, canSplit), canSplit, delta);
      onViewChange(next);
      // A hidden editor can't keep focus, and typing should carry on when it comes back.
      if (next !== "preview") {
        requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body) {
            section.current?.querySelector("textarea")?.focus();
          }
        });
      }
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
          size="xs"
          onClick={() => setHeaderImageOpen(true)}
          title="Set the picture shown above this note's title"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ImageIcon />
          Header image
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggleAssistant}
          aria-label="AI helper"
          aria-pressed={assistantOpen}
          aria-keyshortcuts="Control+Shift+L Meta+Shift+L"
          title="AI helper (Ctrl/Cmd+Shift+L)"
          className="text-muted-foreground hover:text-foreground"
        >
          <MessageSquareIcon />
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
      <div className="flex min-h-0 flex-1">
        <div ref={noteColumn} hidden={dockOver} className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          notes={notes}
          onOpenNote={onOpenNote}
        />
        </div>
        {assistantOpen && (
          <>
            {!dockOver && (
              <ResizeHandle
                label="Resize AI helper"
                valueNow={dock.mode === "beside" ? dock.width : 0}
                valueMin={280}
                valueMax={Math.round(paneWidth * 0.6)}
                onResizeStart={() => {
                  dockDragStart.current = dock.mode === "beside" ? dock.width : wantedDockWidth;
                }}
                onResize={(dx) => setWantedDockWidth(dragDockWidth(dockDragStart.current, dx))}
                onResizeEnd={() => {}}
              />
            )}
            <div
              style={dock.mode === "beside" ? { width: dock.width } : undefined}
              className={cn("min-h-0 shrink-0", dockOver && "w-full")}
            >
              <AssistantPanel
                noteId={note.id}
                noteContent={note.content}
                getSelection={() => (section.current ? readPaneSelection(section.current) : "")}
                onNewNoteFromText={onNewNoteFromText}
                onClose={toggleAssistant}
                onReturnFocus={() => section.current?.querySelector("textarea")?.focus()}
              />
            </div>
          </>
        )}
      </div>
      <HeaderImageDialog
        noteId={note.id}
        open={headerImageOpen}
        onOpenChange={setHeaderImageOpen}
        header={header}
        onChange={(next) =>
          onChange(withHeaderImage(note.content, next, { title: note.title, createdAt: note.createdAt, updatedAt: note.updatedAt }))
        }
      />
      <AttachmentsPanel key={note.id} noteId={note.id} />
      {drop.zone && <DropOverlay zone={drop.zone} />}
    </section>
  );
}
