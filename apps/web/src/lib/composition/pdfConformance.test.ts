import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conformancePath, loadConformance, UPDATING_FIXTURES } from "./__fixtures__/conformance";

/**
 * The PDF tables are a shared schema, so the Swift core must reproduce them exactly. This test pins what the Swift side
 * replays (fixtures/conformance/pdf, described in fixtures/conformance/README.md):
 *
 *   schema.json   the SQL of the three tables, their indexes and their uuid triggers, as a new database holds them
 *   scripts.json  operation scripts over the repositories, each with the rows and results it must end with
 *
 * A change to the TypeScript behaviour fails here until the fixtures are regenerated (`UPDATE_FIXTURES=1 pnpm exec vitest
 * run src/lib/composition/pdfConformance.test.ts`), which is the prompt to update the Swift side too.
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-pdf-conformance-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const TABLES = ["documents", "pdf_annotations", "pdf_bookmarks"] as const;
const UUID = /^[0-9a-f]{32}$/;

type Step = { op: string } & Record<string, unknown>;
type Script = { name: string; steps: Step[]; expect: Outcome | null };
type Outcome = { steps: ({ ok: unknown } | { error: true })[]; documents: unknown[]; annotations: unknown[]; bookmarks: unknown[] };

/** A value with the parts no two runs share replaced by placeholders: uuids, times, and group uuids (numbered by first use). */
function normalizer() {
  const groups = new Map<string, string>();
  const normalize = (value: unknown, key = ""): unknown => {
    if (Array.isArray(value)) return value.map((v) => normalize(v));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
    }
    if (typeof value === "string") {
      if (key === "uuid") {
        expect(value).toMatch(UUID);
        return "<uuid>";
      }
      if (key === "group_uuid" || key === "groupUuid") {
        expect(value).toMatch(UUID);
        if (!groups.has(value)) groups.set(value, `<group-${groups.size + 1}>`);
        return groups.get(value);
      }
      if (["created_at", "createdAt", "updated_at", "updatedAt"].includes(key)) return "<time>";
    }
    return value;
  };
  return normalize;
}

/** Runs a script against a fresh database and says what every step returned and what the three tables hold at the end. */
async function run(script: Script): Promise<Outcome> {
  const { getDb } = await import("./db");
  const documents = await import("./documentsRepo");
  const marks = await import("./pdfMarkupRepo");
  const db = getDb();
  const normalize = normalizer();

  // The arguments are JSON read from the script; the repositories are what check them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops: Record<string, (a: any) => unknown> = {
    /** Makes exactly these notes live and these in the Trash Can: the scripts do not need the notes' rules, only their ids. */
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
    setPageCount: (a) => documents.setPageCount(a.id, a.pageCount) ?? null,
    setViewState: (a) => documents.setViewState(a.id, a.state) ?? null,
    deleteDocument: (a) => documents.deleteDocument(a.id),
    deleteOrphanedDocuments: () => documents.deleteOrphanedDocuments(),
    addAnnotation: (a) => marks.addAnnotation(a.documentId, a.input),
    addAnnotationGroup: (a) => marks.addAnnotationGroup(a.documentId, a.inputs),
    updateAnnotation: (a) => marks.updateAnnotation(a.id, a.changes),
    deleteAnnotation: (a) => marks.deleteAnnotation(a.id),
    addBookmark: (a) => marks.addBookmark(a.documentId, a.page, a.label),
    renameBookmark: (a) => marks.renameBookmark(a.id, a.label),
    deleteBookmark: (a) => marks.deleteBookmark(a.id) ?? null,
  };

  const steps = script.steps.map((step) => {
    const { op, ...args } = step;
    const fn = ops[op];
    if (!fn) throw new Error(`unknown op ${op}`);
    try {
      return { ok: normalize(fn(args)) };
    } catch (error) {
      if (error instanceof Error && ["InvalidMarkError", "DocumentOwnerError"].includes(error.name)) return { error: true as const };
      throw error;
    }
  });
  const rows = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((row) => normalize(row));
  return { steps, documents: rows("documents"), annotations: rows("pdf_annotations"), bookmarks: rows("pdf_bookmarks") };
}

/** The scripts file, one step per line, as scripts.json is kept (the Swift side reads the same file). */
function formatScripts(scripts: Script[]): string {
  const body = scripts
    .map((s) => {
      const steps = s.steps.map((step) => `        ${JSON.stringify(step).replace(/":/g, '": ').replace(/,"/g, ', "')}`).join(",\n");
      const expected = JSON.stringify(s.expect, null, 2).split("\n").join("\n      ");
      return `    {\n      "name": ${JSON.stringify(s.name)},\n      "steps": [\n${steps}\n      ],\n      "expect": ${expected}\n    }`;
    })
    .join(",\n");
  return `{\n  "scripts": [\n${body}\n  ]\n}\n`;
}

describe("the operation scripts", () => {
  const { scripts } = loadConformance<{ scripts: Script[] }>("pdf/scripts.json");

  if (UPDATING_FIXTURES) {
    it("are rewritten from the TypeScript behaviour", async () => {
      const written: Script[] = [];
      for (const script of scripts) {
        // each script needs its own database: a fresh home and fresh modules
        vi.resetModules();
        const { closeDb } = await import("./db");
        closeDb();
        fs.rmSync(path.join(home, ".composition"), { recursive: true, force: true });
        written.push({ ...script, expect: await run(script) });
      }
      fs.writeFileSync(conformancePath("pdf/scripts.json"), formatScripts(written));
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

describe("the schema", () => {
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
    // Only the SQL is compared, collapsed to single spaces: the Swift side may lay its DDL out as it likes.
    const actual = rows.map((r) => ({ type: r.type, name: r.name, table: r.tbl_name, sql: r.sql.replace(/\s+/g, " ").trim() }));

    // PRAGMA table_info says the same thing without caring how the table's SQL is laid out
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
      fs.writeFileSync(conformancePath("pdf/schema.json"), `${JSON.stringify(schema, null, 2)}\n`);
      return;
    }
    expect(schema).toEqual(loadConformance("pdf/schema.json"));
  });
});
