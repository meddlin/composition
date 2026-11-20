import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conformancePath, loadConformance, UPDATING_FIXTURES } from "./__fixtures__/conformance";
import type { PdfRect } from "./pdfMarkup";
import {
  RECOGNIZED_TEXT_FLOOR,
  InvalidScanError,
  coveredByKept,
  recognizedStatus,
  scanPageText,
  validateRecognizedLine,
  type RecognizedLineInput,
  type ScanLineText,
} from "./scanText";

/**
 * Scanned pages and the text read from them are a shared schema and shared rules, so the Swift core must reproduce them
 * exactly. This test pins what the Swift side replays (fixtures/conformance/scan, described in fixtures/conformance/README.md):
 *
 *   text.json     the rules, written by hand: the guard, how a recognised line is stored, a page's search text, and when
 *                 reading a page again leaves a new line out
 *   schema.json   the SQL of the two tables, their indexes and their uuid triggers, as a new database holds them
 *   scripts.json  operation scripts over scansRepo.ts and documentsRepo.ts, each with what every step returned and the rows
 *                 it must end with
 *
 * A change to the TypeScript behaviour fails here until the fixtures are regenerated (`UPDATE_FIXTURES=1 pnpm exec vitest
 * run src/lib/composition/scanConformance.test.ts`), which is the prompt to update the Swift side too.
 */

describe("the rules (text.json)", () => {
  type Corpus = {
    floor: number;
    guard: { name: string; text: string; confidence: number; status: string }[];
    lines: { name: string; input: RecognizedLineInput; stored?: unknown; invalid?: boolean }[];
    pages: { name: string; lines: ScanLineText[]; text: string }[];
    covered: { name: string; rect: PdfRect; kept: PdfRect[]; covered: boolean }[];
  };
  const corpus = loadConformance<Corpus>("scan/text.json");

  it("has the floor InkTranscript has", () => {
    expect(RECOGNIZED_TEXT_FLOOR).toBe(corpus.floor);
  });

  for (const entry of corpus.guard) {
    it(`guard: ${entry.name}`, () => {
      expect(recognizedStatus(entry.text, entry.confidence)).toBe(entry.status);
    });
  }

  for (const entry of corpus.lines) {
    it(`line: ${entry.name}`, () => {
      if (entry.invalid) {
        expect(() => validateRecognizedLine(entry.input)).toThrow(InvalidScanError);
      } else {
        expect(validateRecognizedLine(entry.input)).toEqual(entry.stored);
      }
    });
  }

  for (const entry of corpus.pages) {
    it(`page: ${entry.name}`, () => {
      expect(scanPageText(entry.lines)).toBe(entry.text);
    });
  }

  for (const entry of corpus.covered) {
    it(`covered: ${entry.name}`, () => {
      expect(coveredByKept(entry.rect, entry.kept)).toBe(entry.covered);
    });
  }
});

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-scan-conformance-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const TABLES = ["scan_pages", "scan_lines"] as const;
const UUID = /^[0-9a-f]{32}$/;
const TIMES = ["created_at", "createdAt", "updated_at", "updatedAt", "recognized_at", "recognizedAt"];

type Step = { op: string } & Record<string, unknown>;
type Script = { name: string; steps: Step[]; expect: Outcome | null };
type Outcome = { steps: ({ ok: unknown } | { error: true })[]; documents: unknown[]; pages: unknown[]; lines: unknown[] };

/** A value with the parts no two runs share replaced by placeholders: uuids and times. */
function normalize(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  }
  if (typeof value === "string") {
    if (key === "uuid") {
      expect(value).toMatch(UUID);
      return "<uuid>";
    }
    if (TIMES.includes(key)) return "<time>";
  }
  return value;
}

/** Runs a script against a fresh database and says what every step returned and what the tables hold at the end. */
async function run(script: Script): Promise<Outcome> {
  const { getDb } = await import("./db");
  const documents = await import("./documentsRepo");
  const scans = await import("./scansRepo");
  const db = getDb();

  // The arguments are JSON read from the script; the repositories are what check them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: Record<string, (a: any) => unknown> = {
    setNotes: ({ live, trashed }: { live: number[]; trashed: number[] }) => {
      db.prepare("DELETE FROM notes").run();
      db.prepare("DELETE FROM trashed_notes").run();
      for (const id of live) db.prepare("INSERT INTO notes (id, title, created_at, updated_at) VALUES (?, ?, 'x', 'x')").run(id, `note ${id}`);
      for (const id of trashed) {
        db.prepare("INSERT INTO trashed_notes (id, title, created_at, updated_at, deleted_at) VALUES (?, ?, 'x', 'x', 'x')").run(id, `note ${id}`);
      }
      return null;
    },
    addDocument: (a) => documents.addDocument(a),
    deleteDocument: (a) => documents.deleteDocument(a.id),
    deleteOrphanedDocuments: () => documents.deleteOrphanedDocuments(),
    addScanPages: (a) => scans.addScanPages(a.documentId, a.pageCount),
    isScan: (a) => scans.isScan(a.documentId),
    listScanPages: (a) => scans.listScanPages(a.documentId),
    pendingScanPages: (a) => scans.pendingScanPages(a.documentId),
    storeRecognition: (a) => scans.storeRecognition(a.documentId, a.page, a.engine, a.lines),
    listScanLines: (a) => scans.listScanLines(a.documentId, a.page),
    checkScanLine: (a) => scans.checkScanLine(a.id),
    correctScanLine: (a) => scans.correctScanLine(a.id, a.text),
    scanSummary: (a) => scans.scanSummary(a.documentId),
    scanPageTexts: (a) => scans.scanPageTexts(a.documentId),
  };

  const steps = script.steps.map((step) => {
    const { op, ...args } = step;
    const fn = ops[op];
    if (!fn) throw new Error(`unknown op ${op}`);
    try {
      return { ok: normalize(fn(args)) };
    } catch (error) {
      if (error instanceof Error && ["InvalidScanError", "DocumentOwnerError"].includes(error.name)) return { error: true as const };
      throw error;
    }
  });
  const rows = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((row) => normalize(row));
  return { steps, documents: rows("documents"), pages: rows("scan_pages"), lines: rows("scan_lines") };
}

/** The scripts file, one step per line, as scripts.json is kept (the Swift side reads the same file). */
function formatScripts(scripts: Script[], raw: Script[]): string {
  const body = scripts
    .map((s, index) => {
      // The steps are written as they were read, so a `$repeat` stays one.
      const steps = raw[index].steps.map((step) => `        ${JSON.stringify(step).replace(/":/g, '": ').replace(/,"/g, ', "')}`).join(",\n");
      const expected = JSON.stringify(s.expect, null, 2).split("\n").join("\n      ");
      return `    {\n      "name": ${JSON.stringify(s.name)},\n      "steps": [\n${steps}\n      ],\n      "expect": ${expected}\n    }`;
    })
    .join(",\n");
  return `{\n  "scripts": [\n${body}\n  ]\n}\n`;
}

describe("the operation scripts (scripts.json)", () => {
  const { scripts } = loadConformance<{ scripts: Script[] }>("scan/scripts.json");

  if (UPDATING_FIXTURES) {
    it("are rewritten from the TypeScript behaviour", async () => {
      const raw = (JSON.parse(fs.readFileSync(conformancePath("scan/scripts.json"), "utf8")) as { scripts: Script[] }).scripts;
      const written: Script[] = [];
      for (const script of scripts) {
        vi.resetModules();
        const { closeDb } = await import("./db");
        closeDb();
        fs.rmSync(path.join(home, ".composition"), { recursive: true, force: true });
        written.push({ ...script, expect: await run(script) });
      }
      fs.writeFileSync(conformancePath("scan/scripts.json"), formatScripts(written, raw));
    });
    return;
  }

  for (const script of scripts) {
    it(script.name, async () => {
      expect(script.expect, "regenerate the fixtures: UPDATE_FIXTURES=1").not.toBeNull();
      expect(await run(script)).toEqual(script.expect);
    });
  }
});

describe("the schema (schema.json)", () => {
  type Row = { type: string; name: string; tbl_name: string; sql: string };

  it("is the SQL the Swift core creates, for the tables, their indexes and their uuid triggers", async () => {
    const { getDb } = await import("./db");
    const rows = getDb()
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE tbl_name IN (${TABLES.map((t) => `'${t}'`).join(", ")}) AND sql IS NOT NULL
         ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
      )
      .all() as Row[];
    const actual = rows.map((r) => ({ type: r.type, name: r.name, table: r.tbl_name, sql: r.sql.replace(/\s+/g, " ").trim() }));
    const columns = Object.fromEntries(
      TABLES.map((table) => [
        table,
        (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[]).map(
          ({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull: notnull === 1, default: dflt_value, primaryKey: pk === 1 }),
        ),
      ]),
    );
    const schema = { columns, objects: actual };

    if (UPDATING_FIXTURES) {
      fs.writeFileSync(conformancePath("scan/schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
      return;
    }
    expect(schema).toEqual(loadConformance("scan/schema.json"));
  });
});
