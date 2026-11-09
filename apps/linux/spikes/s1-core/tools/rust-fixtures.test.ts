import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * The desktop's half of the Linux core's round trip (docs/linux-native-app-design.md, spike S1). The Rust tests
 * (`cargo test`, see run.sh) make `rust-empty.db`, `rust-populated.db`, `rust-backup.tar.gz` and `rust-backup-large.tar.gz`
 * in the conformance directory. This file hands each to the desktop's own code, unchanged:
 *
 *   - the real `db.ts` opens the databases Rust touched, and must find nothing to do (no row changed, and the schema cookie,
 *     which every DDL statement bumps, did not move);
 *   - the real `stageBackup` and `applyStagedBackup` restore the archives Rust wrote, and the real data layer then finds
 *     what Rust said was in them.
 *
 * Nothing runs unless `COMPOSITION_CONFORMANCE_DIR` is set. Like `apps/web/scripts/ios-conformance-fixtures.test.ts` (which makes
 * the desktop-side files this directory also holds), it belongs in `apps/web/scripts/` to run; run.sh copies it into a scratch
 * checkout and does not touch the real one.
 */

const dir = process.env.COMPOSITION_CONFORMANCE_DIR;
const lib = process.env.COMPOSITION_WEB_LIB ?? path.resolve(__dirname, "../src/lib/composition");

type Snapshot = { schemaVersion: number; schema: unknown[]; tables: Record<string, unknown[]> };

function snapshot(file: string): Snapshot {
  const db = new Database(file, { readonly: true });
  try {
    const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const tables: Record<string, unknown[]> = {};
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]) {
      tables[name] = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
    }
    return { schemaVersion: db.pragma("schema_version", { simple: true }) as number, schema, tables };
  } finally {
    db.close();
  }
}

/** A throwaway HOME with the real data layer loaded against it. */
async function withHome<T>(work: (context: { home: string; dataDir: string; dbPath: string }) => Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-rust-fixture-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.resetModules();
  const { loadWebSettings, resolvedDbPath } = await import(path.join(lib, "webSettings"));
  const settings = loadWebSettings();
  return work({ home, dataDir: settings.appDataDir, dbPath: resolvedDbPath(settings) });
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

describe.skipIf(!dir)("the desktop opens and restores what the Rust core wrote", () => {
  it.each(["rust-empty", "rust-populated"])("the real db.ts finds nothing to do in %s.db", async (name) => {
    await withHome(async ({ dataDir, dbPath }) => {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.copyFileSync(path.join(dir!, `${name}.db`), dbPath);
      const before = snapshot(dbPath);
      const { getDb, closeDb } = await import(path.join(lib, "db"));
      getDb();
      closeDb();
      const after = snapshot(dbPath);
      expect(after.schemaVersion, "no DDL ran: the schema cookie did not move").toBe(before.schemaVersion);
      expect(after.schema).toEqual(before.schema);
      expect(after.tables).toEqual(before.tables);
      expect(Object.keys(before.tables)).toContain("notes");
    });
  });

  it("rust-empty.db is the same schema as the file the desktop makes from nothing", () => {
    const rust = snapshot(path.join(dir!, "rust-empty.db"));
    const desktop = snapshot(path.join(dir!, "desktop-empty.db"));
    expect(rust.schema).toEqual(desktop.schema);
  });

  it.each(["rust-backup", "rust-backup-large", "rust-backup-pdf"])(
    "the real stageBackup and applyStagedBackup restore %s",
    async (name) => {
      const file = path.join(dir!, `${name}.tar.gz`);
      if (!fs.existsSync(file)) return;
      const expected = JSON.parse(fs.readFileSync(path.join(dir!, `${name}.expected.json`), "utf8")) as {
        counts: Record<string, number>;
        notes: unknown[];
        trashedNotes: unknown[];
        files: Record<string, string>;
      };
      await withHome(async ({ dataDir }) => {
        const { getDb, closeDb } = await import(path.join(lib, "db"));
        getDb();
        closeDb();
        const { stageBackup, applyStagedBackup } = await import(path.join(lib, "backup"));
        const { loadWebSettings, resolvedDbPath } = await import(path.join(lib, "webSettings"));

        const staged = await stageBackup(file, dataDir);
        expect(staged.counts).toEqual(expected.counts);
        applyStagedBackup(staged, { appDataDir: dataDir, dbPath: resolvedDbPath(loadWebSettings()) });

        // The desktop's own parse adds this machine's data location to what it hands back; a backup never carries one.
        const settingsFile = path.join(dir!, `${name}.settings.json`);
        if (fs.existsSync(settingsFile)) {
          const { appDataDir: _dir, dbPath: _db, ...restored } = staged.settings as Record<string, unknown>;
          expect(restored, "the settings.json Rust carried over, as the desktop reads it").toEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")));
        }

        const db = getDb();
        const rows = (table: string) => db.prepare(`SELECT id, uuid, title FROM ${table} ORDER BY id`).all();
        expect(rows("notes")).toEqual(expected.notes);
        expect(rows("trashed_notes")).toEqual(expected.trashedNotes);
        const files: Record<string, string> = {};
        for (const folder of ["app_data", "attachments", "documents"]) {
          const sub = path.join(dataDir, folder);
          if (!fs.existsSync(sub)) continue;
          for (const entry of fs.readdirSync(sub).sort()) files[`${folder}/${entry}`] = sha256(path.join(sub, entry));
        }
        expect(files).toEqual(expected.files);
        expect(Object.keys(files).length).toBeGreaterThan(0);
      });
    },
    300_000,
  );
});
