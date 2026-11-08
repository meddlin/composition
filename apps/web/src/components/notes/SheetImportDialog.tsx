"use client";

import { FileSpreadsheetIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type ImportResult, type ImportSummary, type Reason, type Workbook, importRange, importedHash, parseRange, rangeText } from "./mdx/sheetImport";
import { type SheetSource } from "./mdx/sheetDraft";

/** What an import gives the note: the sheet's two blocks and where they came from (see `<Sheet source sheet range imported>`). */
export type ImportedSheet = { source: SheetSource; file: string; sheet: string; range: string; imported: string };

type Props = {
  open: boolean;
  /** Turns the bytes of a file into a workbook (it is loaded when something is imported, not with the note). */
  loadWorkbook: (bytes: Uint8Array) => Promise<Workbook>;
  /** Closed without importing. */
  onClose: () => void;
  onImported: (imported: ImportedSheet) => void;
};

/** A workbook is read whole into memory, so a file past this is refused with the reason, and not tried. */
export const MAX_WORKBOOK_BYTES = 50 * 1024 * 1024;

const count = (n: number, noun: string, plural = `${noun}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? noun : plural}`;
const because = (reasons: Reason[]) => reasons.map(({ reason, count: n }) => `${reason} (${n})`).join("; ");

/** What an import did, in sentences, one for each thing worth knowing; the first says how big the sheet is. */
export function describeImport({ rows, columns, formulas, calculated, carried, values, unchecked, carriedWhy, valuesWhy }: ImportSummary): string[] {
  const lines = [`${count(rows, "row")} (the first is the header) by ${count(columns, "column")}.`];
  if (formulas === 0) return [...lines, "No formulas: every cell is the value Excel showed."];
  lines.push(`${count(formulas, "formula")}:`);
  if (calculated > 0) lines.push(`${count(calculated, "is", "are")} kept as ${calculated === 1 ? "a formula" : "formulas"}, calculated here, where they gave the number Excel saved.`);
  if (carried > 0) lines.push(`${count(carried, "is", "are")} carried: the formula is kept, and the cell shows Excel's value without calculating it again. Why: ${because(carriedWhy)}.`);
  if (values > 0) lines.push(`${count(values, "is", "are")} kept as ${values === 1 ? "a value" : "values"}, because ${values === 1 ? "it reads" : "they read"} outside the range: ${because(valuesWhy)}.`);
  if (unchecked > 0) lines.push(`${count(unchecked, "formula")} had no value saved by Excel, so could not be checked against one.`);
  return lines;
}

type Chosen = { file: string; workbook: Workbook };

/**
 * **Import from Excel…**: pick a workbook, say which sheet and which range of it, see what would come across, and put it in
 * the note as a `<Sheet>` that remembers where it came from. The file is chosen with a plain file input, so the page gets its
 * bytes and never a path, and is read in the browser; nothing is sent anywhere.
 */
export function SheetImportDialog({ open, ...props }: Props) {
  // Mounted only while open, so each opening starts fresh.
  return open ? <ImportSession {...props} /> : null;
}

function ImportSession({ loadWorkbook, onClose, onImported }: Omit<Props, "open">) {
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState("");
  // What is in the box, and the range it was last settled on (a range is read when it is finished, not with each key).
  const [typed, setTyped] = useState("");
  const [range, setRange] = useState("");

  async function choose(file: File) {
    setProblem(null);
    if (file.size > MAX_WORKBOOK_BYTES) {
      setProblem(`That file is ${(file.size / (1024 * 1024)).toFixed(0)} MB, and a workbook is read whole: ${MAX_WORKBOOK_BYTES / (1024 * 1024)} MB is the most.`);
      return;
    }
    setReading(true);
    try {
      const workbook = await loadWorkbook(new Uint8Array(await file.arrayBuffer()));
      const first = workbook.sheets[0];
      if (!first) throw new Error("It has no sheets.");
      setChosen({ file: file.name, workbook });
      setSheetName(first.name);
      setTyped(first.used);
      setRange(first.used);
    } catch (reason) {
      setChosen(null);
      setProblem(`${file.name} could not be read as an Excel workbook${reason instanceof Error && reason.message ? `: ${reason.message}` : "."}`);
    } finally {
      setReading(false);
    }
  }

  const outcome = useMemo<ImportResult | { ok: false; error: string } | null>(() => {
    if (!chosen) return null;
    if (range.trim() === "") return { ok: false, error: "That sheet has nothing in it." };
    const parsed = parseRange(range);
    if (!parsed) return { ok: false, error: "Write the range as A1:F40, the corners of the cells to bring." };
    const read = chosen.workbook.read(sheetName, rangeText(parsed));
    return "error" in read ? { ok: false, error: read.error } : importRange(read);
  }, [chosen, sheetName, range]);

  function choosesheet(name: string) {
    const sheet = chosen?.workbook.sheets.find((candidate) => candidate.name === name);
    if (!sheet) return;
    setSheetName(name);
    setTyped(sheet.used);
    setRange(sheet.used);
  }

  async function insert() {
    if (!chosen || !outcome?.ok) return;
    const parsed = parseRange(range);
    if (!parsed) return;
    onImported({ source: outcome.source, file: chosen.file, sheet: sheetName, range: rangeText(parsed), imported: await importedHash(outcome.source) });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import from Excel</DialogTitle>
          <DialogDescription>
            Bring a range of an Excel workbook into the note as a sheet. It comes as the values Excel showed; its formulas are kept where they can be trusted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={reading} onClick={() => picker.current?.click()}>
              <FileSpreadsheetIcon />
              {reading ? "Reading…" : chosen ? "Choose another file…" : "Choose an Excel file…"}
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{chosen?.file ?? "An .xlsx workbook"}</span>
            <input
              ref={picker}
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Excel workbook"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file again still counts.
                event.target.value = "";
                if (file) void choose(file);
              }}
            />
          </div>

          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}

          {chosen && (
            <>
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  Sheet
                  <select
                    value={sheetName}
                    onChange={(event) => choosesheet(event.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {chosen.workbook.sheets.map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>
                        {sheet.name}
                        {sheet.used ? ` (${sheet.used})` : " (empty)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Range
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    onBlur={() => setRange(typed)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setRange(typed);
                      }
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-8 w-36 rounded-md border bg-background px-2 font-mono text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  />
                </label>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">The first row of the range becomes the header of the sheet, its row 1.</p>

              <div role="status" className="text-sm">
                {outcome && !outcome.ok ? (
                  <p className="text-destructive">{outcome.error}</p>
                ) : outcome?.ok ? (
                  <ul className="flex list-disc flex-col gap-1 pl-5">
                    {describeImport(outcome.summary).map((line) => (
                      <li key={line} className={line.endsWith(":") ? "list-none -ml-5 font-medium" : undefined}>
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void insert()} disabled={!outcome?.ok}>
            Insert sheet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
