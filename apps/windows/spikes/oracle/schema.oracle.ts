// Spike S1, schema half. Phase "write": the real db.ts makes the databases and dumps what it made.
// Phase "reverse": after the .NET side has written its own, the real db.ts opens them and must find nothing to change.
import fs from "node:fs";
import path from "node:path";
import { COMPOSITION_LIB, Database, dumpData, dumpSchema, isolatedHome, oracleDir, populate, readJson, writeJson, writeOldestDatabase, type SchemaDump } from "./support";

const phase = process.env.COMPOSITION_ORACLE_PHASE ?? "write";

async function openWithRealDb(home: string): Promise<{ closeDb: () => void; getDb: () => import("better-sqlite3").Database }> {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  vi.resetModules();
  return (await import(path.join(COMPOSITION_LIB, "db"))) as never;
}

describe.runIf(phase === "write")("the desktop's db.ts writes the reference databases", () => {
  it("a fresh database", async () => {
    const dir = oracleDir();
    const { home, dbFile } = isolatedHome();
    const { getDb, closeDb } = await openWithRealDb(home);
    const db = getDb();
    writeJson(path.join(dir, "ts-fresh.schema.json"), dumpSchema(db));
    closeDb();
    expect(fs.existsSync(dbFile)).toBe(true);
  });

  it("the oldest database, migrated in place", async () => {
    const dir = oracleDir();
    const { home, dbFile } = isolatedHome();
    writeOldestDatabase(dbFile);
    fs.copyFileSync(dbFile, path.join(dir, "old.db")); // the .NET side migrates this copy
    const { getDb, closeDb } = await openWithRealDb(home);
    const db = getDb();
    writeJson(path.join(dir, "ts-old-migrated.schema.json"), dumpSchema(db));
    writeJson(path.join(dir, "ts-old-migrated.data.json"), dumpData(db));
    closeDb();
  });

  it("a populated database whose rows were inserted without a uuid", async () => {
    const dir = oracleDir();
    const { home, appDataDir } = isolatedHome();
    const { getDb, closeDb } = await openWithRealDb(home);
    const db = getDb();
    populate(db, (sql, ...params) => void db.prepare(sql).run(...params));
    // images and an attachment on disk, as the app would have them
    fs.mkdirSync(path.join(appDataDir, "app_data"), { recursive: true });
    fs.mkdirSync(path.join(appDataDir, "attachments"), { recursive: true });
    fs.writeFileSync(path.join(appDataDir, "app_data", "diagram-0123456789ab.png"), Buffer.from("PNGDATA-1"));
    fs.writeFileSync(path.join(appDataDir, "app_data", "photo-0123456789ab.jpg"), Buffer.from("JPEGDATA-22"));
    fs.writeFileSync(path.join(appDataDir, "attachments", "spec-1a2b3c.pdf"), Buffer.from("%PDF-1"));
    // a name long enough to need a GNU long-name entry in the tar
    const longName = "a-very-long-image-name-".repeat(5) + "0123456789ab.png";
    fs.writeFileSync(path.join(appDataDir, "app_data", longName), Buffer.from("LONG"));
    expect(Buffer.byteLength(`app_data/${longName}`)).toBeGreaterThan(100);

    writeJson(path.join(dir, "ts-populated.schema.json"), dumpSchema(db));
    writeJson(path.join(dir, "ts-populated.data.json"), dumpData(db));
    fs.rmSync(path.join(dir, "ts-populated.db"), { force: true }); // VACUUM INTO refuses an existing file; a re-run must work
    db.prepare("VACUUM INTO ?").run(path.join(dir, "ts-populated.db")); // a database the desktop has touched, for the .NET no-op check

    const { createBackup } = await import(path.join(COMPOSITION_LIB, "backup"));
    const { loadWebSettings } = await import(path.join(COMPOSITION_LIB, "webSettings"));
    const summary = await createBackup({ file: path.join(dir, "ts-backup.tar.gz"), db, appDataDir, settings: loadWebSettings() });
    writeJson(path.join(dir, "ts-backup.summary.json"), summary);
    closeDb();
  });
});

describe.runIf(phase === "reverse")("the desktop's db.ts opens what the .NET side wrote", () => {
  for (const name of ["net-fresh", "net-old-migrated"]) {
    it(`${name}.db is a no-op for db.ts`, async () => {
      const dir = oracleDir();
      const { home, dbFile } = isolatedHome();
      fs.copyFileSync(path.join(dir, `${name}.db`), dbFile);
      for (const suffix of ["-wal", "-shm"]) {
        const side = path.join(dir, `${name}.db${suffix}`);
        if (fs.existsSync(side)) fs.copyFileSync(side, dbFile + suffix);
      }
      // before: read the file with a plain connection (no schema pass)
      const raw = new Database(dbFile, { readonly: false });
      const before = { schema: dumpSchema(raw), data: dumpData(raw) };
      raw.close();

      const { getDb, closeDb } = await openWithRealDb(home);
      const db = getDb();
      const after = { schema: dumpSchema(db), data: dumpData(db) };
      closeDb();

      expect(after.schema.master).toEqual(before.schema.master); // no table, index or trigger text changed
      expect(after.schema.columns).toEqual(before.schema.columns);
      expect(after.schema.schemaVersion).toBe(before.schema.schemaVersion); // SQLite's own "schema changed" counter did not move
      expect(after.data).toEqual(before.data); // no row (uuid included) changed
      writeJson(path.join(dir, `ts-read-${name}.result.json`), { ok: true, tables: Object.keys(after.data).length });
    });
  }

  it("the .NET backup restores through the real stageBackup and applyStagedBackup", async () => {
    const dir = oracleDir();
    const { home, appDataDir, dbFile } = isolatedHome();
    process.env.HOME = home;
    vi.resetModules();
    const backup = await import(path.join(COMPOSITION_LIB, "backup"));
    const staged = await backup.stageBackup(path.join(dir, "net-backup.tar.gz"), appDataDir);
    const expected = readJson<{ counts: Record<string, number> }>(path.join(dir, "net-backup.summary.json"));
    expect(staged.counts).toEqual(expected.counts);
    expect(staged.hasImages).toBe(true);
    expect(staged.hasAttachments).toBe(true);
    backup.applyStagedBackup(staged, { appDataDir, dbPath: dbFile });

    const { getDb, closeDb } = await openWithRealDb(home);
    const db = getDb();
    const restored = dumpData(db);
    closeDb();
    const netData = readJson<Record<string, unknown[]>>(path.join(dir, "net-fresh.data.json"));
    for (const table of ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups", "attachments"]) {
      expect(restored[table], table).toEqual(netData[table]); // every column, uuid included, survives the trip
    }
    expect(fs.readFileSync(path.join(appDataDir, "app_data", "diagram-0123456789ab.png"), "utf8")).toBe("PNGDATA-1");
    expect(fs.readFileSync(path.join(appDataDir, "attachments", "spec-1a2b3c.pdf"), "utf8")).toBe("%PDF-1");
    const longNames = fs.readdirSync(path.join(appDataDir, "app_data")).filter((n) => n.length > 90);
    expect(longNames.length).toBe(1); // the GNU long-name entry the .NET writer made was understood
    writeJson(path.join(dir, "ts-read-net-backup.result.json"), { ok: true, counts: staged.counts });
  });
});
