"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MutableRefObject } from "react";
import { cn } from "@/lib/utils";
import { columnLabel, columnWidths, isErrorValue, isNumberCell } from "./mdx/sheetData";
import {
  type Draft,
  calculateDraft,
  canInsertRow,
  clearCells,
  formatClipboard,
  insertRow,
  parseClipboard,
  pasteBlock,
  setCell,
} from "./mdx/sheetDraft";
import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS } from "./mdx/sheetFormula";

/** Every row is this tall, in pixels, which is what lets a long sheet draw only the rows in view (the preview does the same). */
const ROW_PX = 28;
/** The row of column letters, which stays at the top. */
const HEADER_PX = 28;
/** Rows drawn beyond each edge of the window, so a fast scroll doesn't show blank rows before the next frame. */
const OVERSCAN = 10;
/** What the window is assumed to be before it has been measured (and where nothing can be: a test). */
const ASSUMED_VIEWPORT_PX = 600;
/** A column is never narrower than this, in characters, so an empty one is still something to aim at and type in. */
const MIN_COLUMN_CHARS = 10;
/** The same looks as the preview's header and row numbers (see Sheet.tsx), which stay put while the rows go by underneath. */
const STUCK = "bg-background bg-[linear-gradient(var(--muted),var(--muted))]";

export type Cell = { row: number; col: number };
/** The cells selected: a rectangle from `anchor` to `focus`, the cell the keyboard acts on. */
export type Selection = { anchor: Cell; focus: Cell };

export const cellSelection = (cell: Cell): Selection => ({ anchor: cell, focus: cell });

/** The rectangle a selection covers, corners in order. */
export function selectionBounds({ anchor, focus }: Selection) {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export const addressOf = ({ row, col }: Cell) => `${columnLabel(col)}${row + 1}`;

type Editing = { row: number; col: number; text: string };

type Props = {
  draft: Draft;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** A change to the sheet; the caller keeps what it needs for undo. */
  onChange: (draft: Draft) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Something to tell the user about what was just done (or null to clear it). */
  onNotice: (message: string | null) => void;
  /** Ctrl/Cmd+S, with the sheet as it is, a cell being typed in included. */
  onSave: (draft: Draft) => void;
  /** Set to whether a cell is being typed in, which the dialog around the grid needs to know for Escape. */
  editingRef: MutableRefObject<boolean>;
};

/**
 * The sheet as a grid you can type in. It behaves as a spreadsheet does: arrows, Tab and Enter move between cells,
 * typing replaces a cell and F2 (or a double click) edits it, Delete clears, a range pasted from Excel fills cells and
 * a selection copies out as it came in. A formula is typed as `=…` and the cell shows its result once you leave it.
 *
 * Only the rows in view are drawn, as in the preview, so a sheet of 5,000 rows costs no more than one of 50. The
 * grid is one tab stop (as an ARIA grid is): the keyboard moves a highlight among the cells and `aria-activedescendant`
 * says which one, so a cell being scrolled out of the window and back is no loss of focus.
 */
export function SheetGrid({ draft, selection, onSelect, onChange, onUndo, onRedo, onNotice, onSave, editingRef }: Props) {
  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Leaving a cell by Enter, Tab or Escape unmounts its input, and the blur that may follow is not a second decision.
  const finishing = useRef(false);
  // Where a run of Tab-ed cells began: Enter at the end of the row goes back to that column on the row below, as it does in Excel.
  const tabStart = useRef<number | null>(null);
  const dragging = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(ASSUMED_VIEWPORT_PX);

  const rows = draft.rows.length;
  const columns = draft.columns;
  const calculated = useMemo(() => calculateDraft(draft), [draft]);
  const widths = useMemo(() => columnWidths(calculated.sheet).map((chars) => Math.max(MIN_COLUMN_CHARS, chars)), [calculated]);
  const { focus } = selection;
  const bounds = selectionBounds(selection);

  useEffect(() => {
    editingRef.current = editing !== null;
  }, [editing, editingRef]);

  // The grid has the keyboard from the start, so a sheet can be typed into at once (the dialog leaves the focus to it).
  useEffect(() => {
    table.current?.focus();
  }, []);

  // How tall the window is, so the rows to draw can be told; a window that is resized is measured again.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || ASSUMED_VIEWPORT_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A drag that started on a cell ends wherever the button is let go.
  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // The cell the keyboard is on is kept in view: the rows by arithmetic (it may not be drawn yet), the columns by the browser.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = focus.row * ROW_PX;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (HEADER_PX + top + ROW_PX > el.scrollTop + el.clientHeight && el.clientHeight > 0) el.scrollTop = HEADER_PX + top + ROW_PX - el.clientHeight;
    document.getElementById(`${id}-${focus.row}-${focus.col}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focus.row, focus.col, id]);

  // Keep the selection inside the sheet when rows or columns have gone (an undo, a delete).
  useEffect(() => {
    const inside = (cell: Cell): Cell => ({ row: clamp(cell.row, 0, rows - 1), col: clamp(cell.col, 0, columns - 1) });
    const { anchor } = selection;
    if (focus.row >= rows || focus.col >= columns || anchor.row >= rows || anchor.col >= columns) {
      onSelect({ anchor: inside(anchor), focus: inside(focus) });
    }
  }, [rows, columns, selection, focus, onSelect]);

  const windowed = rows * ROW_PX > viewport;
  const first = windowed ? clamp(Math.floor(scrollTop / ROW_PX) - OVERSCAN, 0, rows) : 0;
  const last = windowed ? clamp(first + Math.ceil(viewport / ROW_PX) + 2 * OVERSCAN, 0, rows) : rows;
  const page = Math.max(1, Math.floor((viewport - HEADER_PX) / ROW_PX) - 1);

  const select = (anchor: Cell, to: Cell) => {
    tabStart.current = null;
    onSelect({ anchor, focus: to });
  };
  const focusGrid = () => table.current?.focus();

  function startEditing(cell: Cell, text?: string) {
    finishing.current = false;
    onNotice(null);
    setEditing({ row: cell.row, col: cell.col, text: text ?? draft.rows[cell.row][cell.col] });
  }

  /**
   * Ends the edit, keeping what was typed or not, and moves the selection by `move`. With `undefined` (the cell
   * lost focus because something else was clicked) the selection and the focus are left to what was clicked.
   */
  function finish(keep: boolean, move: { rows: number; cols: number } | null | undefined) {
    if (!editing) return;
    finishing.current = true;
    setEditing(null);
    let next = keep ? setCell(draft, editing.row, editing.col, editing.text) : draft;
    let target: Cell = { row: editing.row, col: editing.col };
    const startedAt = tabStart.current;
    if (move) {
      // Enter on the last row, after typing something, starts the next row, as filling in a table does.
      if (move.rows === 1 && editing.row === next.rows.length - 1 && next !== draft && canInsertRow(next) && !next.totals) next = insertRow(next, next.rows.length);
      const col = move.rows === 1 && move.cols === 0 && startedAt !== null ? startedAt : target.col + move.cols;
      target = { row: clamp(target.row + move.rows, 0, next.rows.length - 1), col: clamp(col, 0, next.columns - 1) };
    }
    if (next !== draft) onChange(next);
    if (move === undefined) return;
    select(target, target);
    if (move?.cols) tabStart.current = startedAt ?? editing.col;
    focusGrid();
  }

  function handleEditingKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s" && editing) {
      event.preventDefault();
      finishing.current = true;
      setEditing(null);
      return onSave(setCell(draft, editing.row, editing.col, editing.text));
    }
    switch (event.key) {
      case "Enter":
        event.preventDefault();
        return finish(true, { rows: event.shiftKey ? -1 : 1, cols: 0 });
      case "Tab":
        event.preventDefault();
        return finish(true, { rows: 0, cols: event.shiftKey ? -1 : 1 });
      case "Escape":
        event.preventDefault();
        return finish(false, null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (editing || event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    const { row, col } = focus;
    const go = (to: Cell, extend = event.shiftKey) => {
      event.preventDefault();
      select(extend ? selection.anchor : to, to);
    };
    switch (event.key) {
      case "ArrowUp":
        return go({ row: mod ? 0 : Math.max(0, row - 1), col });
      case "ArrowDown":
        return go({ row: mod ? rows - 1 : Math.min(rows - 1, row + 1), col });
      case "ArrowLeft":
        return go({ row, col: mod ? 0 : Math.max(0, col - 1) });
      case "ArrowRight":
        return go({ row, col: mod ? columns - 1 : Math.min(columns - 1, col + 1) });
      case "Home":
        return go({ row: mod ? 0 : row, col: 0 });
      case "End":
        return go({ row: mod ? rows - 1 : row, col: columns - 1 });
      case "PageUp":
        return go({ row: Math.max(0, row - page), col });
      case "PageDown":
        return go({ row: Math.min(rows - 1, row + page), col });
      case "Enter":
        return go({ row: clamp(row + (event.shiftKey ? -1 : 1), 0, rows - 1), col }, false);
      case "Tab": {
        const to = event.shiftKey
          ? col > 0
            ? { row, col: col - 1 }
            : row > 0
              ? { row: row - 1, col: columns - 1 }
              : null
          : col < columns - 1
            ? { row, col: col + 1 }
            : row < rows - 1
              ? { row: row + 1, col: 0 }
              : null;
        // Past the first or last cell Tab goes on to the next control, so the grid is not somewhere the keyboard is stuck.
        if (to) go(to, false);
        return;
      }
      case "F2":
        event.preventDefault();
        return startEditing(focus);
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        const cleared = clearCells(draft, { row: bounds.top, col: bounds.left }, { row: bounds.bottom, col: bounds.right });
        if (cleared !== draft) onChange(cleared);
        return;
      }
    }
    if (mod && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        return onSave(draft);
      }
      if (key === "z") {
        event.preventDefault();
        return event.shiftKey ? onRedo() : onUndo();
      }
      if (key === "y") {
        event.preventDefault();
        return onRedo();
      }
      if (key === "a") {
        event.preventDefault();
        return onSelect({ anchor: { row: 0, col: 0 }, focus: { row: rows - 1, col: columns - 1 } });
      }
      return;
    }
    // A character starts a new value in the cell (AltGr, which reports Ctrl and Alt together, makes characters too).
    if (event.key.length === 1 && !event.metaKey && (!event.ctrlKey || event.altKey)) {
      event.preventDefault();
      startEditing(focus, event.key);
    }
  }

  /** What is selected, as the rows of text a copy puts on the clipboard: each cell as it is shown. */
  function selectedValues(): string[][] {
    return calculated.sheet.rows.slice(bounds.top, bounds.bottom + 1).map((cells) => cells.slice(bounds.left, bounds.right + 1));
  }

  function handleCopy(event: ClipboardEvent<HTMLTableElement>) {
    if (editing) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", formatClipboard(selectedValues()));
  }

  function handleCut(event: ClipboardEvent<HTMLTableElement>) {
    if (editing) return;
    handleCopy(event);
    const cleared = clearCells(draft, { row: bounds.top, col: bounds.left }, { row: bounds.bottom, col: bounds.right });
    if (cleared !== draft) onChange(cleared);
  }

  function handlePaste(event: ClipboardEvent<HTMLTableElement>) {
    if (editing) return;
    event.preventDefault();
    const block = parseClipboard(event.clipboardData.getData("text/plain"));
    if (block.length === 0) return;
    // One value pasted over several cells fills them all, as it does in Excel.
    const height = bounds.bottom - bounds.top + 1;
    const width = bounds.right - bounds.left + 1;
    const filled = block.length === 1 && block[0].length === 1 && height * width > 1 ? Array.from({ length: height }, () => Array<string>(width).fill(block[0][0])) : block;
    const { draft: next, cut } = pasteBlock(draft, bounds.top, bounds.left, filled);
    onNotice(cut ? `Some of what was pasted was left off: a sheet holds at most ${MAX_SHEET_ROWS.toLocaleString("en-US")} rows and ${MAX_SHEET_COLUMNS} columns.` : null);
    if (next === draft) return;
    onChange(next);
    const lastRow = Math.min(next.rows.length - 1, bounds.top + filled.length - 1);
    const lastCol = Math.min(next.columns - 1, bounds.left + Math.max(...filled.map((line) => line.length)) - 1);
    onSelect({ anchor: { row: bounds.top, col: bounds.left }, focus: { row: lastRow, col: lastCol } });
  }

  const shown = [];
  for (let r = first; r < last; r++) {
    const cells = calculated.sheet.rows[r];
    shown.push(
      <tr key={r} role="row" aria-rowindex={r + 2} style={{ height: ROW_PX }}>
        <th
          role="rowheader"
          scope="row"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            select(event.shiftKey ? selection.anchor : { row: r, col: 0 }, { row: r, col: columns - 1 });
          }}
          className={cn(
            "sticky left-0 z-[1] h-7 cursor-default border-r border-b px-2 py-0 text-right text-xs leading-[27px] font-normal select-none",
            STUCK,
            r >= bounds.top && r <= bounds.bottom ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {r + 1}
        </th>
        {cells.map((value, c) => {
          const active = r === focus.row && c === focus.col;
          const selected = r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right;
          const isEditing = editing?.row === r && editing.col === c;
          const address = `${columnLabel(c)}${r + 1}`;
          const unsupported = calculated.results.get(address)?.unsupported ?? [];
          const carried = calculated.carried.has(address);
          return (
            <td
              key={c}
              id={`${id}-${r}-${c}`}
              role="gridcell"
              aria-selected={selected}
              title={carried ? "Calculated by Excel, and not calculated again here. Type over the cell to calculate it." : unsupported.length > 0 ? `Not calculated: ${unsupported.join("; ")}` : undefined}
              onMouseDown={(event) => {
                if (event.button !== 0 || isEditing) return;
                dragging.current = true;
                select(event.shiftKey ? selection.anchor : { row: r, col: c }, { row: r, col: c });
              }}
              onMouseEnter={(event) => {
                if (dragging.current && event.buttons === 1) select(selection.anchor, { row: r, col: c });
              }}
              onDoubleClick={() => startEditing({ row: r, col: c })}
              className={cn(
                "relative h-7 scroll-mt-8 scroll-ml-14 overflow-hidden border-r border-b px-2 py-0 leading-[27px] text-ellipsis whitespace-nowrap",
                r === 0 && "font-semibold",
                carried && "after:absolute after:top-1 after:right-1 after:size-1.5 after:rounded-full after:bg-primary/60",
                selected && "bg-primary/10",
                active && "outline-2 -outline-offset-2 outline-primary",
                isNumberCell(value) && "text-right",
                isErrorValue(value) && "text-destructive",
              )}
            >
              {isEditing ? (
                <input
                  ref={input}
                  autoFocus
                  aria-label={`Cell ${address}`}
                  value={editing.text}
                  onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                  onKeyDown={handleEditingKey}
                  onBlur={() => {
                    if (!finishing.current) finish(true, undefined);
                  }}
                  onFocus={(event) => event.currentTarget.setSelectionRange(editing.text.length, editing.text.length)}
                  spellCheck={false}
                  autoComplete="off"
                  className="absolute inset-0 w-full bg-background px-2 text-sm outline-2 -outline-offset-2 outline-primary"
                />
              ) : (
                value
              )}
            </td>
          );
        })}
      </tr>,
    );
  }
  const spacer = (away: number) =>
    away > 0 ? (
      <tr aria-hidden="true" style={{ height: away * ROW_PX }}>
        <td colSpan={columns + 1} className="p-0" />
      </tr>
    ) : null;

  return (
    <div
      ref={scroller}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="relative min-h-0 flex-1 overflow-auto rounded-md border bg-background text-sm has-[table:focus-visible]:ring-3 has-[table:focus-visible]:ring-ring/50"
    >
      <table
        ref={table}
        role="grid"
        aria-label="Sheet"
        aria-multiselectable="true"
        aria-rowcount={rows + 1}
        aria-colcount={columns + 1}
        aria-activedescendant={editing ? undefined : `${id}-${focus.row}-${focus.col}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        className="w-max min-w-full border-separate border-spacing-0 text-left tabular-nums outline-none"
        style={{ tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "3.5rem" }} />
          {widths.map((chars, c) => (
            <col key={c} style={{ width: `${chars + 2}ch` }} />
          ))}
        </colgroup>
        <thead>
          <tr role="row" aria-rowindex={1} style={{ height: HEADER_PX }}>
            <th role="columnheader" scope="col" className={cn("sticky top-0 left-0 z-20 border-r border-b", STUCK)} />
            {widths.map((_, c) => (
              <th
                key={c}
                role="columnheader"
                scope="col"
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  select(event.shiftKey ? selection.anchor : { row: 0, col: c }, { row: rows - 1, col: c });
                }}
                className={cn(
                  "sticky top-0 z-10 cursor-default overflow-hidden border-r border-b px-2 py-0 text-center text-xs font-normal select-none",
                  STUCK,
                  c >= bounds.left && c <= bounds.right ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {columnLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spacer(first)}
          {shown}
          {spacer(rows - last)}
        </tbody>
      </table>
    </div>
  );
}
