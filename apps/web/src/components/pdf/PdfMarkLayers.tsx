"use client";

import { Trash2Icon } from "lucide-react";
import { Fragment, useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PdfAnnotation } from "@/lib/composition/documentsApi";
import { PDF_MARK_COLORS, type PdfRect, type PdfTextNoteBody } from "@/lib/composition/pdfMarkup";
import { cn } from "@/lib/utils";
import { boxToRaw, boxesOf, paintFor, rawToBox, scaleOf, type Box, type PageViewportLike } from "./pdfGeometry";
import type { PdfViewerControls } from "./usePdfViewer";

/** A page pdf.js has drawn, with the two layers of ours inside it: one under its text, for the marks, and one over it. */
export type PageLayers = { pageNumber: number; element: HTMLElement; viewport: PageViewportLike; under: HTMLElement; over: HTMLElement };

/** Where a new text note goes, and how big it starts, in points. */
export const NEW_NOTE_WIDTH = 200;
export const NEW_NOTE_HEIGHT = 56;
export const NOTE_FONT_SIZE = 12;

/**
 * The layer of ours in a page: `under` sits just above the page image and below its text, so the marks tint the page and
 * the words can still be selected through them, and `over` sits above everything, for what must be clicked or typed in
 * (text notes, the popover of a selected mark). Neither takes the mouse unless something in it asks to.
 */
function layerIn(page: HTMLElement, which: "under" | "over"): HTMLElement {
  const name = `pdfMarkLayer-${which}`;
  const existing = page.querySelector<HTMLElement>(`:scope > .${name}`);
  if (existing) return existing;
  const layer = page.ownerDocument.createElement("div");
  layer.className = name;
  layer.style.cssText = `position:absolute;inset:0;pointer-events:none;${which === "over" ? "z-index:5;" : ""}`;
  const canvas = page.querySelector(":scope > .canvasWrapper");
  if (which === "under" && canvas) canvas.after(layer);
  else page.append(layer);
  return layer;
}

/**
 * The layers of every page that is drawn, kept current as pdf.js draws pages again (it rebuilds a page's contents each time,
 * which removes what was laid over it) and as the zoom changes.
 */
export function usePageLayers(controls: PdfViewerControls | null): PageLayers[] {
  const [layers, setLayers] = useState<PageLayers[]>([]);
  useEffect(() => {
    if (!controls) return;
    const sync = () => setLayers(controls.pagesOnScreen().map((page) => ({ ...page, under: layerIn(page.element, "under"), over: layerIn(page.element, "over") })));
    const first = requestAnimationFrame(sync);
    const stop = controls.onPagesChanged(sync);
    return () => {
      cancelAnimationFrame(first);
      stop();
    };
  }, [controls]);
  return layers;
}

const boxStyle = (box: Box): CSSProperties => ({ position: "absolute", left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top });

/** The marks of one page that lie on its text: tinted, underlined or struck through. */
function TextMarks({ marks, layers, selectedId, dark }: { marks: PdfAnnotation[]; layers: PageLayers; selectedId: number | null; dark: boolean }) {
  return (
    <>
      {marks
        .filter((m) => m.rects && m.page === layers.pageNumber - 1)
        .map((mark) => {
          const paint = paintFor(mark.color);
          const selected = mark.id === selectedId;
          return boxesOf(mark, layers.viewport).map((box, index) => {
            const h = box.bottom - box.top;
            const line = Math.max(1.5, h * 0.09);
            return (
              <div
                key={`${mark.id}-${index}`}
                data-mark-id={mark.id}
                data-mark-kind={mark.kind}
                data-mark-color={mark.color}
                style={{
                  ...boxStyle(box),
                  ...(mark.kind === "highlight" ? { background: paint.fill, mixBlendMode: dark ? ("screen" as const) : ("multiply" as const) } : {}),
                  ...(selected ? { outline: `2px solid ${paint.line}`, outlineOffset: 1 } : {}),
                }}
              >
                {mark.kind !== "highlight" && (
                  <div style={{ position: "absolute", left: 0, right: 0, height: line, background: paint.line, ...(mark.kind === "underline" ? { bottom: 0 } : { top: (h - line) / 2 }) }} />
                )}
              </div>
            );
          });
        })}
    </>
  );
}

/** What a text note, or a draft of one, is typed in: a box over the page, in the note's own size. */
function NoteEditor({ box, fontSize, initial, onCommit, onCancel }: { box: Box; fontSize: number; initial: string; onCommit: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  // Enter writes a new line, as in any note; the box is left by clicking elsewhere, Escape (which drops the change) or Mod+Enter.
  function onKeyDown(event: ReactKeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Escape") onCancel();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onCommit(text);
  }
  return (
    <textarea
      autoFocus
      aria-label="Text note"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ ...boxStyle(box), fontSize, lineHeight: 1.25, pointerEvents: "auto", resize: "none", padding: 3, color: "#111", background: "rgba(255,255,255,0.96)", border: "1px solid #888", borderRadius: 3 }}
    />
  );
}

const COLOR_NAMES: Record<string, string> = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", orange: "Orange" };

/** What a mark that is selected offers: its color, a one-line comment, and deleting it. */
function MarkPopover({
  mark,
  box,
  pageWidth,
  onRecolor,
  onComment,
  onDelete,
}: {
  mark: PdfAnnotation;
  box: Box;
  pageWidth: number;
  onRecolor: (color: string) => void;
  onComment: (comment: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(mark.comment);
  const isNote = mark.kind === "text";
  const left = Math.max(4, Math.min(box.left, pageWidth - 264));
  return (
    <div
      role="dialog"
      aria-label="Mark"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      style={{ position: "absolute", left, top: box.bottom + 6, width: 260, pointerEvents: "auto" }}
      className="flex flex-col gap-2 rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow-md"
    >
      <div className="flex items-center gap-1.5">
        {PDF_MARK_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={COLOR_NAMES[color]}
            aria-pressed={mark.color === color}
            onClick={() => onRecolor(color)}
            style={{ background: paintFor(color).fill, borderColor: paintFor(color).line }}
            className={cn("size-5 rounded-full border", mark.color === color && "ring-2 ring-foreground ring-offset-1")}
          />
        ))}
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" aria-label="Delete this mark" onClick={onDelete}>
          <Trash2Icon />
        </Button>
      </div>
      {!isNote && (
        <Input
          aria-label="Comment"
          placeholder="Add a comment"
          maxLength={500}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft !== mark.comment && onComment(draft)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") onComment(draft);
          }}
          className="h-7"
        />
      )}
    </div>
  );
}

/** What the reader asks of the marks laid over its pages. */
export type MarkLayersProps = {
  layers: PageLayers[];
  marks: PdfAnnotation[];
  selectedId: number | null;
  /** The pages are drawn inverted, where a highlight has to lighten the page instead of darkening it to show. */
  dark?: boolean;
  /** Dropping a text note: the next click on a page puts a draft box there. */
  placing: boolean;
  /** A text note being typed for the first time: it is not a mark until it has words in it. */
  draft: { page: number; rect: PdfRect } | null;
  /** A text note being retyped. */
  editingId: number | null;
  onPlace: (page: number, rect: PdfRect) => void;
  onCommitDraft: (text: string) => void;
  onCancelDraft: () => void;
  onSelect: (id: number | null) => void;
  onEdit: (id: number | null) => void;
  onCommitEdit: (mark: PdfAnnotation, text: string) => void;
  onRecolor: (mark: PdfAnnotation, color: string) => void;
  onComment: (mark: PdfAnnotation, comment: string) => void;
  onDelete: (mark: PdfAnnotation) => void;
};

/** Draws the reader's marks into the layers of the pages that are drawn. */
export function MarkLayers(props: MarkLayersProps) {
  const { layers, marks, selectedId, placing, draft, editingId, dark = false } = props;
  return (
    <>
      {layers.map((page) => {
        const pageIndex = page.pageNumber - 1;
        const here = marks.filter((m) => m.page === pageIndex);
        const selected = here.find((m) => m.id === selectedId) ?? null;
        const scale = scaleOf(page.viewport);
        return (
          <Fragment key={page.pageNumber}>
            {createPortal(<TextMarks marks={here} layers={page} selectedId={selectedId} dark={dark} />, page.under)}
            {createPortal(
              <>
                {here
                  .filter((m) => m.kind === "text")
                  .map((note) => {
                    const body = note.body as PdfTextNoteBody;
                    const box = rawToBox(body.rect, page.viewport);
                    const fontSize = (body.fontSize ?? NOTE_FONT_SIZE) * scale;
                    if (note.id === editingId) {
                      return <NoteEditor key={note.id} box={box} fontSize={fontSize} initial={body.text} onCommit={(text) => props.onCommitEdit(note, text)} onCancel={() => props.onEdit(null)} />;
                    }
                    const paint = paintFor(note.color);
                    return (
                      <div
                        key={note.id}
                        data-mark-id={note.id}
                        data-mark-kind="text"
                        role="note"
                        tabIndex={0}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onSelect(note.id);
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          props.onEdit(note.id);
                        }}
                        style={{ ...boxStyle(box), fontSize, lineHeight: 1.25, pointerEvents: "auto", cursor: "text", padding: 3, overflow: "hidden", whiteSpace: "pre-wrap", color: "#111", background: paint.fill.replace(/[\d.]+\)$/, "0.85)"), border: `1px solid ${paint.line}`, borderRadius: 3, outline: note.id === selectedId ? `2px solid ${paint.line}` : undefined }}
                      >
                        {body.text}
                      </div>
                    );
                  })}
                {draft && draft.page === pageIndex && (
                  <NoteEditor box={rawToBox(draft.rect, page.viewport)} fontSize={NOTE_FONT_SIZE * scale} initial="" onCommit={props.onCommitDraft} onCancel={props.onCancelDraft} />
                )}
                {placing && (
                  <div
                    aria-label={`Place a text note on page ${page.pageNumber}`}
                    role="button"
                    style={{ position: "absolute", inset: 0, cursor: "crosshair", pointerEvents: "auto" }}
                    onClick={(event) => {
                      const at = event.currentTarget.getBoundingClientRect();
                      const left = event.clientX - at.left;
                      const top = event.clientY - at.top;
                      props.onPlace(pageIndex, boxToRaw({ left, top, right: left + NEW_NOTE_WIDTH * scale, bottom: top + NEW_NOTE_HEIGHT * scale }, page.viewport));
                    }}
                  />
                )}
                {selected && !placing && editingId !== selected.id && (
                  <MarkPopover
                    key={selected.id}
                    mark={selected}
                    box={boxesOf(selected, page.viewport).at(-1) ?? { left: 0, top: 0, right: 0, bottom: 0 }}
                    pageWidth={page.element.clientWidth}
                    onRecolor={(color) => props.onRecolor(selected, color)}
                    onComment={(comment) => props.onComment(selected, comment)}
                    onDelete={() => props.onDelete(selected)}
                  />
                )}
              </>,
              page.over,
            )}
          </Fragment>
        );
      })}
    </>
  );
}
