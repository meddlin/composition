import { getDb } from "./db";
import type { PdfRect } from "./pdfMarkup";
import {
  InvalidScanError,
  coveredByKept,
  oneLine,
  scanPageText,
  validateRecognizedLine,
  type RecognizedLineInput,
  type ScanLineStatus,
} from "./scanText";

/**
 * Scanned pages and the lines read from them (db.ts SCANS_SCHEMA; the rules are scanText.ts). The Swift core's
 * `ScansStore.swift` is a port with the same SQL, replayed against fixtures/conformance/scan/scripts.json.
 */

export type ScanPage = { id: number; uuid: string; documentId: number; page: number; engine: string | null; recognizedAt: string | null; createdAt: string };

export type ScanLine = {
  id: number;
  uuid: string;
  documentId: number;
  page: number;
  line: number;
  rect: PdfRect;
  text: string;
  confidence: number;
  engine: string;
  status: ScanLineStatus;
  corrected: string | null;
  createdAt: string;
  updatedAt: string;
};

/** How far reading a scan has got, and what a person has looked at. */
export type ScanSummary = { pages: number; recognized: number; lines: number; unchecked: number; held: number; checked: number; corrected: number };

type PageRow = { id: number; uuid: string; document_id: number; page: number; engine: string | null; recognized_at: string | null; created_at: string };

type LineRow = {
  id: number;
  uuid: string;
  document_id: number;
  page: number;
  line: number;
  rect: string;
  text: string;
  confidence: number;
  engine: string;
  status: ScanLineStatus;
  corrected: string | null;
  created_at: string;
  updated_at: string;
};

function pageFromRow(row: PageRow): ScanPage {
  return {
    id: row.id,
    uuid: row.uuid,
    documentId: row.document_id,
    page: row.page,
    engine: row.engine,
    recognizedAt: row.recognized_at,
    createdAt: row.created_at,
  };
}

function lineFromRow(row: LineRow): ScanLine {
  return {
    id: row.id,
    uuid: row.uuid,
    documentId: row.document_id,
    page: row.page,
    line: row.line,
    rect: JSON.parse(row.rect) as PdfRect,
    text: row.text,
    confidence: row.confidence,
    engine: row.engine,
    status: row.status,
    corrected: row.corrected,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const now = () => new Date().toISOString();

/** The longest engine name kept: it names the engine, its settings and the system it ran on, nothing more. */
const MAX_ENGINE_LENGTH = 200;

function checkEngine(engine: unknown): string {
  if (typeof engine !== "string" || engine.trim() === "" || engine.length > MAX_ENGINE_LENGTH) {
    throw new InvalidScanError(`An engine is named, in at most ${MAX_ENGINE_LENGTH} characters.`);
  }
  return engine.trim();
}

/**
 * Makes a PDF a scan of `pageCount` pages, none read yet. Pages it already has are kept as they are. Returns how many were
 * added. Throws `InvalidScanError` when the PDF is gone or the count is not a whole number of at least one.
 */
export function addScanPages(documentId: number, pageCount: number): number {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new InvalidScanError("A scan has at least one page.");
  const db = getDb();
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM documents WHERE id = ?").get(documentId)) throw new InvalidScanError("That PDF no longer exists.");
    const insert = db.prepare("INSERT OR IGNORE INTO scan_pages (document_id, page, created_at) VALUES (?, ?, ?)");
    const at = now();
    let added = 0;
    for (let page = 0; page < pageCount; page++) added += insert.run(documentId, page, at).changes;
    return added;
  }).immediate();
}

/** Whether a PDF is a scan. */
export function isScan(documentId: number): boolean {
  return getDb().prepare("SELECT 1 FROM scan_pages WHERE document_id = ? LIMIT 1").get(documentId) !== undefined;
}

/** The pages of a scan, in order. */
export function listScanPages(documentId: number): ScanPage[] {
  const rows = getDb().prepare("SELECT * FROM scan_pages WHERE document_id = ? ORDER BY page").all(documentId) as PageRow[];
  return rows.map(pageFromRow);
}

/** The pages not read yet, of every scan (or of one), oldest scan first and in page order: what reading picks up after a quit. */
export function pendingScanPages(documentId?: number): { documentId: number; page: number }[] {
  const db = getDb();
  const rows = (
    documentId === undefined
      ? db.prepare("SELECT document_id, page FROM scan_pages WHERE recognized_at IS NULL ORDER BY document_id, page").all()
      : db.prepare("SELECT document_id, page FROM scan_pages WHERE recognized_at IS NULL AND document_id = ? ORDER BY page").all(documentId)
  ) as { document_id: number; page: number }[];
  return rows.map((row) => ({ documentId: row.document_id, page: row.page }));
}

/** The lines of a scan, or of one page of it, in reading order. */
export function listScanLines(documentId: number, page?: number): ScanLine[] {
  const db = getDb();
  const rows = (
    page === undefined
      ? db.prepare("SELECT * FROM scan_lines WHERE document_id = ? ORDER BY page, line, id").all(documentId)
      : db.prepare("SELECT * FROM scan_lines WHERE document_id = ? AND page = ? ORDER BY line, id").all(documentId, page)
  ) as LineRow[];
  return rows.map(lineFromRow);
}

export function getScanLine(id: number): ScanLine | null {
  const row = getDb().prepare("SELECT * FROM scan_lines WHERE id = ?").get(id) as LineRow | undefined;
  return row ? lineFromRow(row) : null;
}

/**
 * Keeps what an engine read on one page, in one transaction, and marks the page read. Lines a person has looked at
 * (`checked`, `corrected`) are kept, and a new line mostly under one of them is left out; every other line the page had is
 * replaced. A new line's `line` is its place in what the engine gave, so reading order is the engine's. Lines with no text
 * are not kept. Returns the page's lines. Throws `InvalidScanError` when the page is not a scanned page of that PDF, or a
 * line or the engine's name is not valid (and then nothing is written).
 */
export function storeRecognition(documentId: number, page: number, engine: string, lines: readonly RecognizedLineInput[]): ScanLine[] {
  const name = checkEngine(engine);
  if (!Array.isArray(lines)) throw new InvalidScanError("The lines are a list.");
  const valid = lines.map((input) => validateRecognizedLine(input));
  const db = getDb();
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM scan_pages WHERE document_id = ? AND page = ?").get(documentId, page)) {
      throw new InvalidScanError("That page is not a scanned page.");
    }
    const kept = (
      db
        .prepare("SELECT rect FROM scan_lines WHERE document_id = ? AND page = ? AND status IN ('checked', 'corrected')")
        .all(documentId, page) as { rect: string }[]
    ).map((row) => JSON.parse(row.rect) as PdfRect);
    db.prepare("DELETE FROM scan_lines WHERE document_id = ? AND page = ? AND status IN ('unchecked', 'held')").run(documentId, page);
    const insert = db.prepare(
      `INSERT INTO scan_lines (document_id, page, line, rect, text, confidence, engine, status, corrected, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    );
    const at = now();
    valid.forEach((line, index) => {
      if (line === null || coveredByKept(line.rect, kept)) return;
      insert.run(documentId, page, index, JSON.stringify(line.rect), line.text, line.confidence, name, line.status, at, at);
    });
    db.prepare("UPDATE scan_pages SET engine = ?, recognized_at = ? WHERE document_id = ? AND page = ?").run(name, at, documentId, page);
  }).immediate();
  return listScanLines(documentId, page);
}

/** A person says the line reads as it was read. Returns the line, or null when there is no such line. */
export function checkScanLine(id: number): ScanLine | null {
  const db = getDb();
  db.prepare("UPDATE scan_lines SET status = 'checked', corrected = NULL, updated_at = ? WHERE id = ?").run(now(), id);
  return getScanLine(id);
}

/**
 * A person writes what the line says (on one line; nothing at all when it says nothing). Writing exactly what was read
 * checks the line instead. Returns the line, or null when there is no such line.
 */
export function correctScanLine(id: number, text: string): ScanLine | null {
  if (typeof text !== "string") throw new InvalidScanError("A correction is text.");
  const db = getDb();
  const current = getScanLine(id);
  if (!current) return null;
  const written = oneLine(text);
  if (written === current.text) return checkScanLine(id);
  db.prepare("UPDATE scan_lines SET status = 'corrected', corrected = ?, updated_at = ? WHERE id = ?").run(written, now(), id);
  return getScanLine(id);
}

/** How far reading a scan has got; null when the PDF is not a scan. */
export function scanSummary(documentId: number): ScanSummary | null {
  const db = getDb();
  const pages = db.prepare("SELECT COUNT(*) AS pages, COUNT(recognized_at) AS recognized FROM scan_pages WHERE document_id = ?").get(documentId) as {
    pages: number;
    recognized: number;
  };
  if (pages.pages === 0) return null;
  const summary: ScanSummary = { pages: pages.pages, recognized: pages.recognized, lines: 0, unchecked: 0, held: 0, checked: 0, corrected: 0 };
  const counts = db.prepare("SELECT status, COUNT(*) AS n FROM scan_lines WHERE document_id = ? GROUP BY status").all(documentId) as {
    status: ScanLineStatus;
    n: number;
  }[];
  for (const { status, n } of counts) {
    if (status in summary) summary[status] += n;
    summary.lines += n;
  }
  return summary;
}

/** The text of every page of a scan that has some, for search (scanText.ts `scanPageText`), in page order. */
export function scanPageTexts(documentId: number): { page: number; text: string }[] {
  const byPage = new Map<number, ScanLine[]>();
  for (const line of listScanLines(documentId)) {
    const lines = byPage.get(line.page) ?? [];
    lines.push(line);
    byPage.set(line.page, lines);
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, lines]) => ({ page, text: scanPageText(lines) }))
    .filter((entry) => entry.text !== "");
}
