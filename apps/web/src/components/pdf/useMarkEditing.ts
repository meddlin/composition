"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { PdfAnnotation, PdfDocument } from "@/lib/composition/documentsApi";
import type { DocumentsStore } from "@/lib/composition/documentsStore";
import type { PdfRect, PdfTextNoteBody } from "@/lib/composition/pdfMarkup";
import { isHighlightColor } from "../notes/mdx/highlightColors";
import { lastHighlightColor, rememberHighlightColor } from "../notes/lastHighlightColor";
import { markAt } from "./pdfGeometry";
import { NOTE_FONT_SIZE, type MarkLayersProps } from "./PdfMarkLayers";
import { marksFromSelection, selectionAnchor } from "./selectionMarks";
import type { TextMarkKind } from "./SelectionToolbar";
import type { PdfViewerControls } from "./usePdfViewer";

const NO_MARKS: PdfAnnotation[] = [];

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Everything the reader does with a PDF's marks, apart from drawing them: reading them from the store, making them from
 * the text selected in a page, placing and retyping text notes, selecting one to recolor, comment on or delete, undoing and
 * redoing, and the keys for all of that. The reader takes what it needs from what this returns.
 */
export function useMarkEditing({ pdf, documents, controls, container }: { pdf: PdfDocument; documents: DocumentsStore; controls: PdfViewerControls | null; container: RefObject<HTMLDivElement | null> }) {
  const snapshot = useSyncExternalStore(documents.subscribe, documents.getSnapshot, documents.getSnapshot);
  const state = snapshot.marks[pdf.id];
  const marks = state?.items ?? NO_MARKS;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [color, setColor] = useState<string>(lastHighlightColor());
  const [anchor, setAnchor] = useState<{ x: number; top: number; bottom: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<{ page: number; rect: PdfRect } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void documents.loadMarks(pdf.id);
  }, [documents, pdf.id]);

  // The selection toolbar follows the text selected in the pages, and goes when there is none, or when the pages are scrolled.
  useEffect(() => {
    const host = container.current;
    const update = () => {
      const selection = window.getSelection();
      const inside = selection && !selection.isCollapsed && host?.contains(selection.anchorNode);
      setAnchor(inside ? selectionAnchor(selection) : null);
    };
    document.addEventListener("selectionchange", update);
    host?.addEventListener("scroll", update, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", update);
      host?.removeEventListener("scroll", update);
    };
  }, [container]);

  const fail = (result: { error?: string }) => {
    if (result.error) setError(result.error);
    return !result.error;
  };

  const chooseColor = useCallback((next: string) => {
    setColor(next);
    if (isHighlightColor(next)) rememberHighlightColor(next);
  }, []);

  async function markSelection(kind: TextMarkKind) {
    const selection = window.getSelection();
    const inputs = marksFromSelection(selection, controls?.pagesOnScreen() ?? [], kind, color);
    if (inputs.length === 0) return;
    const result = await documents.addMarks(pdf.id, inputs);
    if (fail(result)) {
      setError(null);
      selection?.removeAllRanges();
      setAnchor(null);
    }
  }

  async function recolor(mark: PdfAnnotation, next: string) {
    if (mark.color !== next) fail(await documents.changeMark(mark, { color: next }));
    chooseColor(next);
  }

  async function comment(mark: PdfAnnotation, text: string) {
    fail(await documents.changeMark(mark, { comment: text }));
  }

  async function remove(mark: PdfAnnotation) {
    setSelectedId((id) => (id === mark.id ? null : id));
    fail(await documents.removeMark(mark));
  }

  async function commitDraft(text: string) {
    const pending = draft;
    setDraft(null);
    if (!pending || text.trim() === "") return;
    const body: PdfTextNoteBody = { rect: pending.rect, text, fontSize: NOTE_FONT_SIZE };
    const result = await documents.addMarks(pdf.id, [{ page: pending.page, kind: "text", color, body }]);
    if (fail(result)) setError(null);
  }

  async function commitEdit(mark: PdfAnnotation, text: string) {
    setEditingId(null);
    const body = mark.body as PdfTextNoteBody;
    if (text.trim() === "") return void (await remove(mark));
    if (text !== body.text) fail(await documents.changeMark(mark, { body: { ...body, text } }));
  }

  function onContainerClick(event: MouseEvent) {
    if (placing || !controls || !window.getSelection()?.isCollapsed) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>(".page[data-page-number]");
    if (!element) return setSelectedId(null);
    const page = controls.pagesOnScreen().find((p) => p.element === element);
    if (!page) return setSelectedId(null);
    const frame = element.getBoundingClientRect();
    const x = event.clientX - frame.left - element.clientLeft;
    const y = event.clientY - frame.top - element.clientTop;
    const onPage = marks.filter((m) => m.page === page.pageNumber - 1);
    setSelectedId(markAt(onPage, x, y, page.viewport)?.id ?? null);
  }

  /** The reader's keys for marks. Returns whether it used the key. */
  function onKeyDown(event: KeyboardEvent): boolean {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape" && (selectedId !== null || placing || draft)) {
      setSelectedId(null);
      setPlacing(false);
      setDraft(null);
      return true;
    }
    if (typing(event.target)) return false;
    const marked: Record<string, TextMarkKind> = { KeyH: "highlight", KeyU: "underline", KeyS: "strikethrough" };
    if (mod && event.shiftKey && marked[event.code]) {
      event.preventDefault();
      void markSelection(marked[event.code]);
      return true;
    }
    if (mod && event.code === "KeyZ") {
      event.preventDefault();
      void (event.shiftKey ? documents.redoMark(pdf.id) : documents.undoMark(pdf.id)).then(fail);
      return true;
    }
    if (event.ctrlKey && event.code === "KeyY") {
      event.preventDefault();
      void documents.redoMark(pdf.id).then(fail);
      return true;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedId !== null) {
      const mark = marks.find((m) => m.id === selectedId);
      if (mark) {
        event.preventDefault();
        void remove(mark);
        return true;
      }
    }
    return false;
  }

  const layerHandlers: Pick<MarkLayersProps, "onPlace" | "onCommitDraft" | "onCancelDraft" | "onSelect" | "onEdit" | "onCommitEdit" | "onRecolor" | "onComment" | "onDelete"> = {
    onPlace: (page, rect) => {
      setPlacing(false);
      setSelectedId(null);
      setDraft({ page, rect });
    },
    onCommitDraft: (text) => void commitDraft(text),
    onCancelDraft: () => setDraft(null),
    onSelect: setSelectedId,
    onEdit: (id) => {
      setEditingId(id);
      setSelectedId(null);
    },
    onCommitEdit: (mark, text) => void commitEdit(mark, text),
    onRecolor: (mark, next) => void recolor(mark, next),
    onComment: (mark, text) => void comment(mark, text),
    onDelete: (mark) => void remove(mark),
  };

  return {
    marks,
    status: state?.status ?? "loading",
    readError: state?.status === "error" ? state.error : null,
    canUndo: (state?.undoCount ?? 0) > 0,
    canRedo: (state?.redoCount ?? 0) > 0,
    selectedId,
    select: setSelectedId,
    color,
    chooseColor,
    anchor,
    markSelection: (kind: TextMarkKind) => void markSelection(kind),
    placing,
    togglePlacing: () => {
      setPlacing((on) => !on);
      setSelectedId(null);
    },
    draft,
    editingId,
    error,
    clearError: () => setError(null),
    undo: () => void documents.undoMark(pdf.id).then(fail),
    redo: () => void documents.redoMark(pdf.id).then(fail),
    remove: (mark: PdfAnnotation) => void remove(mark),
    comment: (mark: PdfAnnotation, text: string) => void comment(mark, text),
    onContainerClick,
    onKeyDown,
    layerHandlers,
  };
}
