"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { type SheetSource, formatClipboard } from "./mdx/sheetDraft";
import { describeExport, excelSheetName, exportFileName, exportSheet } from "./mdx/sheetExport";
import { canSaveFile, saveFile } from "./exportFile";

type Format = "xlsx" | "csv";

type Props = {
  open: boolean;
  /** The sheet's two blocks, as the note holds them. */
  source: SheetSource;
  /** Its caption, and the file it was imported from: a name for the exported file comes from them. */
  title?: string;
  from?: string;
  onClose: () => void;
};

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * **Export…** on a sheet: its cells as an Excel workbook (formulas as formulas, each with its value) or as CSV, saved as a download;
 * or copied as cells to paste into Excel. It says what is written and what is not first (see sheetExport.ts). The workbook is made
 * only when it is asked for, and the library that writes it is loaded then.
 */
export function SheetExportDialog({ open, ...props }: Props) {
  // Mounted only while open, so each opening starts fresh.
  return open ? <ExportSession {...props} /> : null;
}

function ExportSession({ source, title, from, onClose }: Omit<Props, "open">) {
  const [format, setFormat] = useState<Format>("xlsx");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const exported = useMemo(() => exportSheet(source), [source]);
  const canSave = canSaveFile();

  async function save() {
    if (!exported.ok) return;
    setBusy(true);
    setResult(null);
    try {
      const name = exportFileName(title, from, format);
      if (format === "csv") {
        // A byte order mark first, which Excel needs to read the text as UTF-8.
        saveFile(name, `﻿${exported.csv}\n`, "text/csv;charset=utf-8");
      } else {
        const { writeWorkbook } = await import("./mdx/sheetWorkbookWrite");
        saveFile(name, await writeWorkbook(exported, excelSheetName(title)), XLSX_TYPE);
      }
      setResult({ ok: true, message: `${name} was offered to your browser to save.` });
    } catch {
      setResult({ ok: false, message: "The file could not be made." });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!exported.ok) return;
    try {
      await navigator.clipboard.writeText(formatClipboard(exported.shown));
      setResult({ ok: true, message: "The cells were copied. Paste them into Excel." });
    } catch {
      setResult({ ok: false, message: "The cells could not be copied." });
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export sheet</DialogTitle>
          <DialogDescription>Save the sheet as a file Excel opens, or copy its cells to paste into Excel.</DialogDescription>
        </DialogHeader>

        {!exported.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {exported.error}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <RadioGroup value={format} onValueChange={(next) => setFormat(next as Format)} aria-label="File type" className="gap-2">
              <Field orientation="horizontal">
                <RadioGroupItem value="xlsx" id="export-xlsx" />
                <FieldLabel htmlFor="export-xlsx">Excel workbook (.xlsx), with its formulas</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="csv" id="export-csv" />
                <FieldLabel htmlFor="export-csv">CSV (.csv), the values the sheet shows</FieldLabel>
              </Field>
            </RadioGroup>

            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {(format === "xlsx" ? describeExport(exported.summary) : [`${exported.summary.rows.toLocaleString("en-US")} rows by ${exported.summary.columns.toLocaleString("en-US")} columns, formulas calculated, with commas between the cells.`]).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {!canSave && (
              <p className="text-sm text-muted-foreground">
                The desktop app cannot save a file from here yet. Copy the cells instead and paste them into Excel, or open the note in a browser to save the file.
              </p>
            )}
            {result && (
              <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-sm" : "text-sm text-destructive"}>
                {result.message}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!exported.ok}>
            Copy cells
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!exported.ok || !canSave || busy}>
            {busy ? "Making the file…" : "Download"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
