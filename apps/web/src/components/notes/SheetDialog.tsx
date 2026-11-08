"use client";

import {
  BetweenHorizontalEndIcon,
  BetweenHorizontalStartIcon,
  BetweenVerticalEndIcon,
  BetweenVerticalStartIcon,
  Redo2Icon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseFormulas } from "./mdx/sheetData";
import {
  type Draft,
  type SheetSource,
  calculateDraft,
  canInsertColumn,
  canInsertRow,
  deleteColumn,
  deleteRow,
  draftFromSource,
  draftToSource,
  emptyDraft,
  formatCsv,
  insertColumn,
  insertRow,
  isDraftEmpty,
} from "./mdx/sheetDraft";
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from "./mdx/sheetFormula";
import { SheetGrid, addressOf, cellSelection, selectionBounds, type Selection } from "./SheetGrid";

/** What the editor opens with: nothing (a new sheet), the cells of a Markdown table being promoted, or a sheet's two blocks to change. */
export type SheetEditSource = { kind: "new" } | { kind: "promote"; rows: string[][] } | ({ kind: "edit" } & SheetSource);

type Props = {
  open: boolean;
  source: SheetEditSource;
  /** Closed without saving. */
  onClose: () => void;
  /** Saved: the sheet's two blocks, as the note should now hold them. */
  onSaved: (source: SheetSource) => void;
};

/** How many steps back undo goes. A step shares the rows it did not change, so this is cheap to keep. */
const HISTORY = 100;

type History = { past: Draft[]; present: Draft; future: Draft[] };

function startingDraft(source: SheetEditSource): Draft {
  if (source.kind === "new") return emptyDraft();
  if (source.kind === "promote") return draftFromSource(formatCsv(source.rows), "");
  return draftFromSource(source.csv, source.formulas);
}

/**
 * The sheet editor in a dialog: a grid to type in (see SheetGrid), buttons for rows and columns, and **Save sheet**,
 * which gives the note its two blocks back (the caller writes them as one change, so one undo takes it back).
 * Nothing reaches the note until then, and a Cancel after changes asks first.
 */
export function SheetDialog({ open, ...props }: Props) {
  // Mounted only while open, so each opening starts fresh: the sheet as it is in the note, nothing left unsaved.
  return open ? <SheetSession {...props} /> : null;
}

function SheetSession({ source, onClose, onSaved }: Omit<Props, "open">) {
  const initial = useMemo(() => startingDraft(source), [source]);
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });
  const [selection, setSelection] = useState<Selection>(cellSelection({ row: 0, col: 0 }));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    if (source.kind !== "edit") return null;
    const { problems } = parseFormulas(source.formulas);
    return problems.length === 0
      ? null
      : `${problems.length} ${problems.length === 1 ? "line" : "lines"} of this sheet's formulas block (line ${problems.join(", ")}) ${problems.length === 1 ? "is" : "are"} not a cell and a formula, and will be left out when you save.`;
  });
  const editing = useRef(false);

  const draft = history.present;
  const dirty = draft !== initial;
  const bounds = selectionBounds(selection);
  const rowsSelected = bounds.bottom - bounds.top + 1;
  const columnsSelected = bounds.right - bounds.left + 1;
  const calculated = useMemo(() => calculateDraft(draft), [draft]);

  function commit(next: Draft) {
    setError(null);
    setHistory((h) => (next === h.present ? h : { past: [...h.past.slice(1 - HISTORY), h.present], present: next, future: [] }));
  }
  const undo = () =>
    setHistory((h) => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }));
  const redo = () =>
    setHistory((h) => (h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }));

  /** Applies `change` to the draft once for each row or column selected. */
  function repeat(count: number, change: (draft: Draft) => Draft) {
    let next = draft;
    for (let i = 0; i < count; i++) next = change(next);
    commit(next);
  }

  function save(latest: Draft = draft) {
    const written = draftToSource(latest);
    if (!written.ok) {
      commit(latest);
      setError(written.error);
      return;
    }
    onSaved(written.source);
  }

  function cancel() {
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onClose();
  }

  const active = addressOf(selection.focus);
  const input = draft.rows[selection.focus.row]?.[selection.focus.col] ?? "";
  const result = calculated.results.get(active);

  const tool = (label: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <Button variant="outline" size="xs" onClick={onClick} disabled={disabled}>
      {icon}
      {label}
    </Button>
  );

  return (
    <Dialog open onOpenChange={(next) => !next && cancel()}>
      <DialogContent
        // A sheet is work worth keeping: a stray click outside, or Escape pressed in the dialog, only asks. Escape in a cell leaves the cell.
        onInteractOutside={(event) => event.preventDefault()}
        // The grid takes the focus itself; the first button would otherwise.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (!editing.current) cancel();
        }}
        className="flex h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col sm:max-w-6xl"
      >
        <DialogHeader>
          <DialogTitle>{source.kind === "edit" ? "Edit sheet" : "New sheet"}</DialogTitle>
          <DialogDescription className="sr-only">
            Type in the grid, then Save sheet to put it in the note. Arrows, Tab and Enter move between cells; type to replace a cell, F2 to edit it; a formula starts with an equals sign.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div role="group" aria-label="Undo" className="flex items-center gap-1">
            <Button variant="outline" size="icon-xs" onClick={undo} disabled={history.past.length === 0} aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">
              <Undo2Icon />
            </Button>
            <Button variant="outline" size="icon-xs" onClick={redo} disabled={history.future.length === 0} aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)">
              <Redo2Icon />
            </Button>
          </div>
          <div role="group" aria-label="Rows" className="flex flex-wrap items-center gap-1">
            {tool("Row above", <BetweenHorizontalStartIcon />, () => repeat(rowsSelected, (d) => insertRow(d, bounds.top)), !canInsertRow(draft))}
            {tool(
              "Row below",
              <BetweenHorizontalEndIcon />,
              () => {
                repeat(rowsSelected, (d) => insertRow(d, bounds.bottom + 1));
                setSelection({ anchor: { row: bounds.bottom + 1, col: selection.anchor.col }, focus: { row: bounds.bottom + rowsSelected, col: selection.focus.col } });
              },
              !canInsertRow(draft),
            )}
            {tool(
              "Delete row",
              <Trash2Icon />,
              () => {
                let next = draft;
                for (let r = bounds.bottom; r >= bounds.top; r--) next = deleteRow(next, r);
                commit(next);
              },
              false,
            )}
          </div>
          <div role="group" aria-label="Columns" className="flex flex-wrap items-center gap-1">
            {tool("Column left", <BetweenVerticalStartIcon />, () => repeat(columnsSelected, (d) => insertColumn(d, bounds.left)), !canInsertColumn(draft))}
            {tool(
              "Column right",
              <BetweenVerticalEndIcon />,
              () => {
                repeat(columnsSelected, (d) => insertColumn(d, bounds.right + 1));
                setSelection({ anchor: { row: selection.anchor.row, col: bounds.right + 1 }, focus: { row: selection.focus.row, col: bounds.right + columnsSelected } });
              },
              !canInsertColumn(draft),
            )}
            {tool(
              "Delete column",
              <Trash2Icon />,
              () => {
                let next = draft;
                for (let c = bounds.right; c >= bounds.left; c--) next = deleteColumn(next, c);
                commit(next);
              },
              false,
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 rounded-md border px-2 py-1 font-mono text-xs" data-testid="sheet-formula-line">
          <span className="shrink-0 font-semibold">{active}</span>
          <span className="min-w-0 flex-1 truncate">{input}</span>
          {result && result.unsupported.length > 0 ? (
            <span className="shrink-0 font-sans text-destructive">Not calculated: {result.unsupported.join("; ")}</span>
          ) : null}
        </div>

        <SheetGrid draft={draft} selection={selection} onSelect={setSelection} onChange={commit} onUndo={undo} onRedo={redo} onNotice={setNotice} onSave={save} editingRef={editing} />

        <div className="flex items-center gap-2">
          <p role={error ? "alert" : confirmDiscard || notice ? "status" : undefined} className="min-w-0 flex-1 text-xs text-destructive">
            {error}
            {confirmDiscard && !error && <span className="text-foreground">Discard your changes to the sheet?</span>}
            {notice && !error && !confirmDiscard && <span className="text-foreground">{notice}</span>}
            {!error && !confirmDiscard && !notice && (
              <span className="text-muted-foreground">
                Type to replace a cell, F2 to edit it, Enter and Tab to move, = for a formula. A sheet holds up to {MAX_SHEET_ROWS.toLocaleString("en-US")} rows and {MAX_SHEET_COLUMNS} columns.
              </span>
            )}
          </p>
          {confirmDiscard ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button variant="destructive" size="sm" onClick={onClose}>
                Discard
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={cancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => save()} disabled={isDraftEmpty(draft)}>
                Save sheet
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
