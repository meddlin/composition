import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The desktop's side of the iPad app's conformance checks (docs/ipad-app-design.md, "Keeping two implementations honest";
 * apps/ios/CompositionCore). Not a test of the web app: every case does nothing unless `IOS_FIXTURE_DIR` is set.
 *
 * "writes ..." makes, with the real `db.ts`, repos and `createBackup`:
 *
 *   desktop-empty.db               a database `db.ts` created and nothing more (the Swift schema must match it exactly)
 *   desktop-populated.db           the same after real repo calls (the Swift schema pass must leave it unchanged)
 *   desktop-backup.tar.gz          a real backup of a populated data directory, and desktop-backup.expected.json
 *   desktop-backup-large.tar.gz    the same with one big attachment (IOS_FIXTURE_LARGE_MB megabytes, default 100)
 *   trash-start.db, trash-script.json, trash-script.expected.json
 *                                  the Trash Can: a starting database, the steps in apps/ios/conformance/trash-script.json,
 *                                  and what the real trashRepo.ts did at every step (result and every row afterwards)
 *
 * "reads what the Swift core wrote" restores swift-backup.tar.gz and swift-backup-large.tar.gz with the real
 * `stageBackup` and `applyStagedBackup`, opens the result with the real `db.ts`, and compares it with what Swift said it
 * had put in. The Swift tests make those files, so the order matters; apps/ios/scripts/conformance.sh runs all three steps.
 */

const outDir = process.env.IOS_FIXTURE_DIR;
const lib = path.resolve(__dirname, "../src/lib/composition");

type Repos = {
  notebooks: typeof import("../src/lib/composition/notebooksRepo");
  groups: typeof import("../src/lib/composition/groupsRepo");
  notes: typeof import("../src/lib/composition/notesRepo");
  trash: typeof import("../src/lib/composition/trashRepo");
  attachments: typeof import("../src/lib/composition/attachmentsRepo");
};

type Context = { repos: Repos; dataDir: string; home: string };

/** What a data directory holds, in the shape the Swift side writes and reads as `*.expected.json`. */
type Expected = {
  counts: Record<string, number>;
  notes: { id: number; uuid: string; title: string }[];
  trashedNotes: { id: number; uuid: string; title: string }[];
  files: Record<string, string>;
};

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

/** Runs `work` against a brand-new data layer in a throwaway HOME, then closes the database. */
async function withDesktop<T>(work: (context: Context) => Promise<T>): Promise<{ home: string; value: T }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-ios-fixture-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.resetModules();
  const { getDb, closeDb } = await import(path.join(lib, "db"));
  getDb();
  const { loadWebSettings } = await import(path.join(lib, "webSettings"));
  const value = await work({
    repos: {
      notebooks: await import(path.join(lib, "notebooksRepo")),
      groups: await import(path.join(lib, "groupsRepo")),
      notes: await import(path.join(lib, "notesRepo")),
      trash: await import(path.join(lib, "trashRepo")),
      attachments: await import(path.join(lib, "attachmentsRepo")),
    },
    dataDir: loadWebSettings().appDataDir,
    home,
  });
  closeDb();
  return { home, value };
}

/** Notebooks, nested groups, notes, an image, an attachment, a trashed note and a trashed group, through the real repos. */
function populate({ repos, dataDir }: Context, bigMegabytes = 0): void {
  const { notebooks, groups, notes, trash, attachments } = repos;
  const work = notebooks.createNotebook("Work");
  const projects = groups.createGroup("Projects", null, work.id);
  const sub = groups.createGroup("Sub", projects.id);
  const alpha = notes.createNote("Alpha", "x,y");
  notes.createNote("Beta", "", projects.id);
  const gamma = notes.createNote("Gamma", "", sub.id);
  notes.updateNoteContent(alpha.id, "# Alpha\n\n<Info>Hello</Info>\n\nSee [Beta](note:2).\n![map](app_data/route-map-3f9c2a71b0de.png)\n");
  trash.trashNote(gamma.id);
  const spare = groups.createGroup("Spare");
  trash.trashGroup(spare.id);

  fs.mkdirSync(path.join(dataDir, "app_data"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "attachments"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "app_data", "route-map-3f9c2a71b0de.png"), PNG);
  fs.writeFileSync(path.join(dataDir, "app_data", "Photo-aaaaaaaaaaaa.JPG"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), crypto.randomBytes(5000)]));
  fs.writeFileSync(path.join(dataDir, "attachments", "3f9c2a71b0de-report.pdf"), crypto.randomBytes(3000));
  attachments.addAttachment(alpha.id, "report.pdf", "3f9c2a71b0de-report.pdf", 3000);

  if (bigMegabytes > 0) {
    const fd = fs.openSync(path.join(dataDir, "attachments", "big-aaaaaaaaaaaa.bin"), "w");
    for (let i = 0; i < bigMegabytes; i++) fs.writeSync(fd, crypto.randomBytes(1024 * 1024));
    fs.closeSync(fd);
    attachments.addAttachment(alpha.id, "big.bin", "big-aaaaaaaaaaaa.bin", bigMegabytes * 1024 * 1024);
  }
}

function sha256(file: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const chunk = Buffer.alloc(1024 * 1024);
  for (let read = fs.readSync(fd, chunk, 0, chunk.length, null); read > 0; read = fs.readSync(fd, chunk, 0, chunk.length, null)) {
    hash.update(chunk.subarray(0, read));
  }
  fs.closeSync(fd);
  return hash.digest("hex");
}

/** The notes, trashed notes, and the hash of every image and attachment, read straight from the data directory. */
async function describeDataDirectory(dataDir: string, counts: Record<string, number>): Promise<Expected> {
  const { getDb } = await import(path.join(lib, "db"));
  const db = getDb();
  const rows = (table: string) => db.prepare(`SELECT id, uuid, title FROM ${table} ORDER BY id`).all() as Expected["notes"];
  const files: Record<string, string> = {};
  for (const folder of ["app_data", "attachments"]) {
    const dir = path.join(dataDir, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) files[`${folder}/${name}`] = sha256(path.join(dir, name));
  }
  return { counts, notes: rows("notes"), trashedNotes: rows("trashed_notes"), files };
}

/** The database the Trash Can script starts from, built with the real repos (ids are in the script's "about"). */
function buildTrashStart({ repos }: Context): void {
  const { notebooks, groups, notes } = repos;
  const work = notebooks.createNotebook("Work");
  const projects = groups.createGroup("Projects", null, work.id);
  const sub = groups.createGroup("Sub", projects.id);
  const loose = groups.createGroup("Loose");
  groups.createGroup("Empty");
  groups.createGroup("Old group");
  groups.createGroup("Edge group");
  notes.createNote("Alpha");
  notes.createNote("Beta", "", projects.id);
  notes.createNote("Gamma", "", sub.id);
  notes.createNote("Delta", "", loose.id);
  notes.createNote("Epsilon");
  notes.createNote("Work note", "", null, work.id);
  for (const title of ["Old", "Edge", "Recent", "Tie A", "Tie B"]) notes.createNote(title);
}

type ScriptStep = { op: string; id?: number; at?: string; now?: string; sql?: string; note?: string };

/** The rows of the four tables the Trash Can moves between, and the id counters, as plain JSON. */
async function dumpTables() {
  const { getDb } = await import(path.join(lib, "db"));
  const db = getDb();
  const dump: Record<string, unknown> = {};
  for (const table of ["notes", "groups", "trashed_notes", "trashed_groups"]) {
    dump[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  }
  dump.sqlite_sequence = db.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all();
  return dump;
}

/** Runs one step through the real trashRepo, with the clock set to the step's time. */
async function runTrashStep(step: ScriptStep): Promise<unknown> {
  const trash = await import(path.join(lib, "trashRepo"));
  const { GroupNotEmptyError } = await import(path.join(lib, "groupsRepo"));
  const { getDb } = await import(path.join(lib, "db"));
  if (step.at) vi.setSystemTime(new Date(step.at));
  switch (step.op) {
    case "trashNote":
      trash.trashNote(step.id!);
      return null;
    case "trashGroup":
      try {
        trash.trashGroup(step.id!);
        return null;
      } catch (error) {
        if (error instanceof GroupNotEmptyError) return { error: "groupNotEmpty" };
        throw error;
      }
    case "restoreNote":
      return trash.restoreNote(step.id!);
    case "restoreGroup":
      return trash.restoreGroup(step.id!);
    case "purgeNote":
      trash.purgeNote(step.id!);
      return null;
    case "purgeGroup":
      trash.purgeGroup(step.id!);
      return null;
    case "purgeExpired":
      trash.purgeExpired(new Date(step.now!));
      return null;
    case "listTrash":
      return trash.listTrash();
    case "sql":
      getDb().exec(step.sql!);
      return null;
    default:
      throw new Error(`Unknown step: ${step.op}`);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe.skipIf(!outDir)("iPad conformance fixtures", () => {
  it("writes the databases and the desktop backups", async () => {
    fs.mkdirSync(outDir!, { recursive: true });

    const empty = await withDesktop(async () => {});
    fs.copyFileSync(path.join(empty.home, ".composition", "composition.db"), path.join(outDir!, "desktop-empty.db"));

    const populated = await withDesktop(async (context) => populate(context));
    fs.copyFileSync(path.join(populated.home, ".composition", "composition.db"), path.join(outDir!, "desktop-populated.db"));

    for (const [name, megabytes] of [
      ["desktop-backup", 0],
      ["desktop-backup-large", Number(process.env.IOS_FIXTURE_LARGE_MB ?? 100)],
    ] as const) {
      await withDesktop(async (context) => {
        populate(context, megabytes);
        const { getDb } = await import(path.join(lib, "db"));
        const { loadWebSettings } = await import(path.join(lib, "webSettings"));
        const { createBackup } = await import(path.join(lib, "backup"));
        const file = path.join(outDir!, `${name}.tar.gz`);
        fs.rmSync(file, { force: true });
        const summary = await createBackup({ file, db: getDb(), appDataDir: context.dataDir, settings: loadWebSettings() });
        const expected = await describeDataDirectory(context.dataDir, summary.counts);
        fs.writeFileSync(path.join(outDir!, `${name}.expected.json`), JSON.stringify(expected, null, 2));
      });
    }
    expect(fs.existsSync(path.join(outDir!, "desktop-backup.tar.gz"))).toBe(true);
  }, 300_000);

  it("writes the Trash Can script and what the desktop did with it", async () => {
    fs.mkdirSync(outDir!, { recursive: true });
    const scriptFile = path.resolve(__dirname, "../../ios/conformance/trash-script.json");
    const script = JSON.parse(fs.readFileSync(scriptFile, "utf8")) as { steps: ScriptStep[] };

    await withDesktop(async (context) => {
      buildTrashStart(context);
      const { closeDb, getDb } = await import(path.join(lib, "db"));
      closeDb(); // folds the write-ahead log in, so the copy is the whole database
      fs.copyFileSync(path.join(context.home, ".composition", "composition.db"), path.join(outDir!, "trash-start.db"));
      getDb();

      vi.useFakeTimers({ toFake: ["Date"] });
      const steps: { op: string; result: unknown; dump: unknown }[] = [];
      for (const step of script.steps) {
        const result = await runTrashStep(step);
        steps.push({ op: step.op, result: result ?? null, dump: await dumpTables() });
      }
      vi.useRealTimers();
      fs.copyFileSync(scriptFile, path.join(outDir!, "trash-script.json"));
      fs.writeFileSync(path.join(outDir!, "trash-script.expected.json"), JSON.stringify({ steps }, null, 2));
    });
    expect(fs.existsSync(path.join(outDir!, "trash-script.expected.json"))).toBe(true);
  });

  it.each(["swift-backup", "swift-backup-large"])(
    "reads what the Swift core wrote: %s",
    async (name) => {
      const file = path.join(outDir!, `${name}.tar.gz`);
      const expectedFile = path.join(outDir!, `${name}.expected.json`);
      if (!fs.existsSync(file)) throw new Error(`${file} is missing: run the Swift conformance tests first (apps/ios/scripts/conformance.sh)`);
      const expected = JSON.parse(fs.readFileSync(expectedFile, "utf8")) as Expected;

      // Like a real restore: an empty data directory, the strict stage step, then the swap.
      await withDesktop(async ({ dataDir }) => {
        const { closeDb } = await import(path.join(lib, "db"));
        const { stageBackup, applyStagedBackup } = await import(path.join(lib, "backup"));
        const { loadWebSettings, resolvedDbPath } = await import(path.join(lib, "webSettings"));
        closeDb();

        const staged = await stageBackup(file, dataDir);
        expect(staged.counts).toEqual(expected.counts);
        applyStagedBackup(staged, { appDataDir: dataDir, dbPath: resolvedDbPath(loadWebSettings()) });

        // The real data layer opens the Swift-made database (its schema pass runs) and finds what Swift said was in it.
        const actual = await describeDataDirectory(dataDir, expected.counts);
        expect(actual.notes).toEqual(expected.notes);
        expect(actual.trashedNotes).toEqual(expected.trashedNotes);
        expect(actual.files).toEqual(expected.files);
        expect(Object.keys(actual.files).length).toBeGreaterThan(0);
      });
    },
    300_000,
  );
});
