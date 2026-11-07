import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
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
 *   store-start.db, store-script.json, store-script.expected.json
 *                                  build plan Step 2: notes, groups and notebooks: a starting database, the steps in
 *                                  apps/ios/conformance/store-script.json, and what the real service.ts (its search index
 *                                  stubbed) did at every step (result and every row afterwards)
 *   search-corpus-100.db, search-corpus-1000.db, search-queries.json, search-parse-expected.json, search-expected.json
 *                                  spike S2: generated notes, the queries, what the real parseSearchQuery made of each, and
 *                                  (committed, not regenerated here) what a real Meilisearch answered for each
 *   mdx-notes.json, mdx-expected.json
 *                                  spike S4: the notes in apps/ios/conformance/mdx-notes.json, and what the real preview
 *                                  pipeline (remark-mdx and the desktop's own plugins) makes of each: valid or not, the
 *                                  components with their props, the headings and the footnotes
 *   component-cases.json, component-expected.json
 *                                  spike S4: inputs for the helpers behind the components (chart CSV, repo and YouTube
 *                                  addresses, image width and path) and what the real functions answer for each
 *   frontmatter-cases.json, frontmatter-expected.json
 *                                  build plan Step 3: notes' text through the real frontmatter.ts (parse, generate,
 *                                  withHeaderImage, tag helpers)
 *   settings-cases.json, settings-expected.json
 *                                  build plan Step 1: favorites, themes and saved cities, and what parseWebSettings makes
 *                                  of each; and desktop-backup*.settings.json, the (non-default) settings the desktop
 *                                  backups carry
 *
 * "reads what the Swift core wrote" restores swift-backup.tar.gz and swift-backup-large.tar.gz (which carry the settings
 * the iPad was handed, with its favorites changed) with the real
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

// --- Notes, groups and notebooks (build plan, Step 2) ---------------------------------------------------------------------

/** The database the store script starts from, built with the real repos (ids are in the script's "about"). */
function buildStoreStart({ repos }: Context): void {
  const { notebooks, groups, notes } = repos;
  const work = notebooks.createNotebook("Work");
  notebooks.createNotebook("Archive");
  const projects = groups.createGroup("Projects", null, work.id);
  const sub = groups.createGroup("Sub", projects.id);
  groups.createGroup("Deep", sub.id);
  const loose = groups.createGroup("Loose");
  for (const name of ["Empty", "Second", "Third"]) groups.createGroup(name);
  notes.createNote("Alpha", "x,y");
  notes.createNote("Beta", "", projects.id);
  notes.createNote("Gamma", "", sub.id);
  notes.createNote("Delta", "", 3);
  notes.createNote("Epsilon", "", loose.id);
  for (const title of ["Zeta", "Eta", "Theta"]) notes.createNote(title);
  notes.createNote("Iota", "", loose.id);
  notes.createNote("Kappa", "", loose.id);
  notes.createNote("Work note", "", null, work.id);
}

type StoreStep = {
  op: string;
  at?: string;
  id?: number;
  title?: string;
  name?: string;
  content?: string;
  groupId?: number | null;
  notebookId?: number;
  parentId?: number | null;
  beforeId?: number | null;
  sql?: string;
  note?: string;
};

/** Every table the store script touches, as plain JSON. */
async function dumpStoreTables() {
  const { getDb } = await import(path.join(lib, "db"));
  const db = getDb();
  const dump: Record<string, unknown> = {};
  for (const table of ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups"]) {
    dump[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  }
  dump.sqlite_sequence = db.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all();
  return dump;
}

/** Runs one step through the real service, with the clock set to the step's time; an error comes back as its kind. */
async function runStoreStep(step: StoreStep): Promise<unknown> {
  const service = await import(path.join(lib, "service"));
  const { getDb } = await import(path.join(lib, "db"));
  const notesRepo = await import(path.join(lib, "notesRepo"));
  const groupsRepo = await import(path.join(lib, "groupsRepo"));
  const notebooksRepo = await import(path.join(lib, "notebooksRepo"));
  if (step.at) vi.setSystemTime(new Date(step.at));

  // The service answers some refusals with a message and throws others; both come back as the kind of error.
  const kinds: Record<string, string> = {
    "That group can't be moved there.": "invalidGroupMove",
    "This group still has sub-groups or notes — empty it first.": "groupNotEmpty",
    "The last notebook can't be deleted.": "lastNotebook",
    "This notebook still has groups or notes — empty it first.": "notebookNotEmpty",
  };
  /** A refusal as its kind; null when there was none. */
  const refusal = (value: { error?: string }) => (value.error ? { error: kinds[value.error] ?? value.error } : null);
  /** What a restore answered with; the service words "not in the Trash Can" as an error, the Swift core as nothing. */
  const restored = (value: { error?: string } | null) => (value?.error ? null : (value ?? null));
  /** The group a move answered with, or its refusal. */
  const movedGroup = (value: { group?: unknown; error?: string }) => refusal(value) ?? value.group;
  try {
    switch (step.op) {
      case "createNote":
        return await service.createNote(step.title!, step.groupId ?? null, step.notebookId ?? null);
      case "saveNoteContent":
        return await service.saveNoteContent(step.id!, step.content!);
      case "deleteNote":
        await service.deleteNote(step.id!);
        return null;
      case "restoreNote":
        return restored(await service.restoreNote(step.id!));
      case "moveNoteToGroup":
        return await service.moveNoteToGroup(step.id!, step.groupId ?? null);
      case "placeNote":
        return await service.placeNote(step.id!, step.groupId ?? null, step.beforeId ?? null);
      case "createGroup":
        return await service.createGroup(step.name!, step.parentId ?? null, step.notebookId ?? null);
      case "renameGroup":
        return await service.renameGroup(step.id!, step.name!);
      case "deleteGroup":
        return refusal(await service.deleteGroup(step.id!));
      case "restoreGroup":
        return restored(await service.restoreGroup(step.id!));
      case "moveGroup":
        return movedGroup(await service.moveGroup(step.id!, step.parentId ?? null));
      case "moveGroupToNotebook":
        return movedGroup(await service.moveGroupToNotebook(step.id!, step.notebookId!));
      case "placeGroup":
        return movedGroup(await service.placeGroup(step.id!, step.parentId ?? null, step.beforeId ?? null));
      case "groupIsEmpty":
        return groupsRepo.groupIsEmpty(step.id!);
      case "createNotebook":
        return await service.createNotebook(step.name!);
      case "renameNotebook":
        return await service.renameNotebook(step.id!, step.name!);
      case "placeNotebook":
        return (await service.placeNotebook(step.id!, step.beforeId ?? null)).map((notebook: { id: number }) => notebook.id);
      case "deleteNotebook":
        return refusal(await service.deleteNotebook(step.id!));
      case "listNotes":
        return notesRepo.listNotes().map((note: { id: number }) => note.id);
      case "listGroups":
        return groupsRepo.listGroups().map((group: { id: number }) => group.id);
      case "listNotebooks":
        return notebooksRepo.listNotebooks().map((notebook: { id: number }) => notebook.id);
      case "sql":
        getDb().exec(step.sql!);
        return null;
      default:
        throw new Error(`Unknown step: ${step.op}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found/i.test(message)) return { error: "notFound" };
    if (message === "There are no notebooks.") return { error: "noNotebooks" };
    throw error;
  }
}

// --- Search (spike S2) --------------------------------------------------------------------------------------------------

/** The clock the generated notes are made against, so a corpus is the same on every machine and every day. */
const SEARCH_NOW = Date.parse("2026-11-05T12:00:00.000Z");
const SEARCH_CORPUS_SIZES = [100, 1000] as const;
const searchQueriesFile = path.resolve(__dirname, "../../ios/conformance/search-queries.json");
const searchExpectedFile = path.resolve(__dirname, "../../ios/conformance/search-expected.json");

function searchQueries(): string[] {
  const { groups } = JSON.parse(fs.readFileSync(searchQueriesFile, "utf8")) as { groups: { queries: string[] }[] };
  return groups.flatMap((group) => group.queries);
}

/** The dummy notes of `pnpm search:playground`, written with real frontmatter the way `seedNotes` does, through the real data layer. */
async function fillSearchCorpus(count: number): Promise<void> {
  const { generateNotes } = await import(path.resolve(__dirname, "../../cli/src/tools/dummyNotes"));
  const frontmatter = await import(path.join(lib, "frontmatter"));
  const { getDb } = await import(path.join(lib, "db"));
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id, notebook_id) VALUES (?, ?, ?, '', ?, ?, NULL, 1)",
  );
  db.transaction(() => {
    for (const note of generateNotes(count, 42, SEARCH_NOW) as { title: string; body: string; tags: string; createdAt: string }[]) {
      const content =
        frontmatter.generate(note.title, {
          createdAt: note.createdAt,
          updatedAt: note.createdAt,
          tags: frontmatter.tagsFromString(note.tags),
        }) + note.body;
      insert.run(note.title, content, note.tags, note.createdAt, note.createdAt);
    }
  })();
}

/** What identifies the notes in a corpus, so committed Meilisearch answers can be tied to exactly these notes. */
async function corpusHash(): Promise<string> {
  const { getDb } = await import(path.join(lib, "db"));
  const rows = getDb().prepare("SELECT id, title, description, content, tags, created_at, updated_at FROM notes ORDER BY id").all();
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** A throwaway Meilisearch, started the way the desktop starts its own (apps/desktop/src/main/meili.ts). */
async function withMeilisearch<T>(work: (server: { host: string; apiKey: string; version: string }) => Promise<T>): Promise<T> {
  const binary = process.env.COMPOSITION_MEILI_BIN || "meilisearch";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-ios-meili-"));
  const port = await freePort();
  const apiKey = crypto.randomBytes(16).toString("hex");
  const child = spawn(
    binary,
    ["--db-path", path.join(dir, "data"), "--http-addr", `127.0.0.1:${port}`, "--dump-dir", path.join(dir, "dumps"), "--snapshot-dir", path.join(dir, "snapshots"), "--no-analytics"],
    { cwd: dir, stdio: "ignore", env: { ...process.env, MEILI_MASTER_KEY: apiKey, MEILI_ENV: "production" } },
  );
  const failed = new Promise<never>((_, reject) => child.once("error", (error) => reject(new Error(`Could not start ${binary}: ${error.message}`))));
  try {
    const host = `http://127.0.0.1:${port}`;
    const ready = (async () => {
      for (let attempt = 0; attempt < 150; attempt++) {
        try {
          if ((await fetch(`${host}/health`)).ok) return;
        } catch {
          // not listening yet
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Meilisearch did not become healthy");
    })();
    await Promise.race([ready, failed]);
    const version = ((await (await fetch(`${host}/version`, { headers: { Authorization: `Bearer ${apiKey}` } })).json()) as { pkgVersion: string }).pkgVersion;
    return await work({ host, apiKey, version });
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
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
        const { loadWebSettings, saveWebSettings } = await import(path.join(lib, "webSettings"));
        const { createBackup } = await import(path.join(lib, "backup"));
        // Not the defaults, so a restore that loses or resets a key shows: a scheme, a city, columns, favorites, and more.
        saveWebSettings({
          ...loadWebSettings(),
          theme: "forest",
          sidebarWidth: 321,
          editorRatio: 0.4,
          favorites: [
            { type: "note", id: 1 },
            { type: "group", id: 1 },
          ],
          location: { name: "Reykjavik", latitude: 64.1466, longitude: -21.9426, timezone: "Atlantic/Reykjavik" },
        });
        const file = path.join(outDir!, `${name}.tar.gz`);
        fs.rmSync(file, { force: true });
        const { appDataDir: _dataDir, dbPath: _dbPath, ...portable } = loadWebSettings();
        fs.writeFileSync(path.join(outDir!, `${name}.settings.json`), JSON.stringify(portable, null, 2));
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

  it("writes the store script and what the desktop's service did with it", async () => {
    fs.mkdirSync(outDir!, { recursive: true });
    const scriptFile = path.resolve(__dirname, "../../ios/conformance/store-script.json");
    const script = JSON.parse(fs.readFileSync(scriptFile, "utf8")) as { steps: StoreStep[] };

    await withDesktop(async (context) => {
      buildStoreStart(context);
      const { closeDb, getDb } = await import(path.join(lib, "db"));
      closeDb(); // folds the write-ahead log in, so the copy is the whole database
      fs.copyFileSync(path.join(context.home, ".composition", "composition.db"), path.join(outDir!, "store-start.db"));
      getDb();

      // Meilisearch isn't running; the service indexes best-effort, so a stub keeps the run quiet (as in service.test.ts).
      vi.doMock(path.join(lib, "searchIndex"), () => ({
        indexNote: async () => {},
        deleteNoteFromIndex: async () => {},
        searchNoteIds: async () => [],
        unavailableMessage: () => "unavailable",
      }));

      vi.useFakeTimers({ toFake: ["Date"] });
      const steps: { op: string; result: unknown; dump: unknown }[] = [];
      for (const step of script.steps) {
        const result = await runStoreStep(step);
        steps.push({ op: step.op, result: result ?? null, dump: await dumpStoreTables() });
      }
      vi.useRealTimers();
      vi.doUnmock(path.join(lib, "searchIndex"));
      fs.copyFileSync(scriptFile, path.join(outDir!, "store-script.json"));
      fs.writeFileSync(path.join(outDir!, "store-script.expected.json"), JSON.stringify({ steps }, null, 2));
    });
    expect(fs.existsSync(path.join(outDir!, "store-script.expected.json"))).toBe(true);
  }, 60_000);

  it("writes the search corpora and what the real parseSearchQuery makes of each query", async () => {
    fs.mkdirSync(outDir!, { recursive: true });
    const { parseSearchQuery } = await import(path.join(lib, "searchQuery"));
    const queries = searchQueries();
    expect(queries.length).toBeGreaterThan(200);
    fs.copyFileSync(searchQueriesFile, path.join(outDir!, "search-queries.json"));
    fs.writeFileSync(
      path.join(outDir!, "search-parse-expected.json"),
      JSON.stringify(Object.fromEntries(queries.map((query) => [query, parseSearchQuery(query)])), null, 2),
    );

    const hashes: Record<string, string> = {};
    for (const count of SEARCH_CORPUS_SIZES) {
      const { home } = await withDesktop(async () => {
        await fillSearchCorpus(count);
        hashes[count] = await corpusHash();
      });
      fs.copyFileSync(path.join(home, ".composition", "composition.db"), path.join(outDir!, `search-corpus-${count}.db`));
    }
    fs.writeFileSync(path.join(outDir!, "search-corpus-hashes.json"), JSON.stringify(hashes, null, 2));

    // The committed answers must be for exactly these notes and these queries, or the comparison means nothing.
    if (fs.existsSync(searchExpectedFile)) {
      const expected = JSON.parse(fs.readFileSync(searchExpectedFile, "utf8")) as { corpora: Record<string, { hash: string; results: { query: string }[] }> };
      for (const count of SEARCH_CORPUS_SIZES) {
        expect(expected.corpora[count].hash, `the ${count}-note corpus changed: regenerate apps/ios/conformance/search-expected.json`).toBe(hashes[count]);
        expect(expected.corpora[count].results.map((r) => r.query), "the queries changed: regenerate search-expected.json").toEqual(queries);
      }
      fs.copyFileSync(searchExpectedFile, path.join(outDir!, "search-expected.json"));
    }
  }, 300_000);

  it("writes the MDX notes and what the real preview pipeline makes of each", async () => {
    fs.mkdirSync(outDir!, { recursive: true });
    const file = path.resolve(__dirname, "../../ios/conformance/mdx-notes.json");
    const { notes } = JSON.parse(fs.readFileSync(file, "utf8")) as { notes: { name: string; body: string }[] };
    expect(new Set(notes.map((n) => n.name)).size).toBe(notes.length);

    const mdxDir = path.resolve(__dirname, "../src/components/notes/mdx");
    const { unified } = await import("unified");
    const { default: remarkParse } = await import("remark-parse");
    const { default: remarkGfm } = await import("remark-gfm");
    const { default: remarkMdx } = await import("remark-mdx");
    const { remarkIndentedCode } = await import(path.join(mdxDir, "remarkIndentedCode"));
    const { remarkRestrictMdx, renderKey } = await import(path.join(mdxDir, "remarkRestrictMdx"));
    const { remarkHeadings } = await import(path.join(mdxDir, "remarkHeadings"));
    const { mdxComponents, usesMdxComponent } = await import(path.join(mdxDir, "components"));
    const allowed = Object.keys(mdxComponents);
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdx).use(remarkIndentedCode).use(remarkRestrictMdx, { allowed }).use(remarkHeadings);

    type Node = { type: string; name?: string | null; depth?: number; value?: string; alt?: string | null; identifier?: string; attributes?: { name?: string; value?: unknown }[]; children?: Node[] };
    const plainText = (node: Node): string => node.value ?? node.alt ?? node.children?.map(plainText).join("") ?? "";
    const prefix = renderKey("");

    const expected = Object.fromEntries(
      notes.map(({ name, body }) => {
        if (!usesMdxComponent(body)) return [name, { mdx: false, valid: true, elements: [], headings: [], footnotes: [] }];
        try {
          const tree = processor.runSync(processor.parse(body)) as unknown as Node;
          const elements: { name: string; props: Record<string, string | null>; flow: boolean; depth: number }[] = [];
          const headings: { depth: number; text: string }[] = [];
          const definitions = new Map<string, Node>();
          const order: string[] = [];
          const walk = (node: Node, depth: number) => {
            if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
              const props: Record<string, string | null> = {};
              for (const a of node.attributes ?? []) {
                if (a.name && a.name !== "headings") props[a.name] = typeof a.value === "string" ? a.value : null;
              }
              elements.push({ name: (node.name ?? "").slice(prefix.length), props, flow: node.type === "mdxJsxFlowElement", depth });
              node.children?.forEach((child) => walk(child, depth + 1));
              return;
            }
            if (node.type === "heading" && node.depth) headings.push({ depth: node.depth, text: plainText(node).trim() });
            if (node.type === "footnoteDefinition" && node.identifier !== undefined && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
            node.children?.forEach((child) => walk(child, depth));
          };
          walk(tree, 0);
          // Footnotes are numbered by where they are first cited (the notes of a footnote after those of the text).
          const cite = (node: Node) => {
            if (node.type === "footnoteReference" && node.identifier !== undefined && definitions.has(node.identifier) && !order.includes(node.identifier)) order.push(node.identifier);
            if (node.type !== "footnoteDefinition") node.children?.forEach(cite);
          };
          cite(tree);
          for (let i = 0; i < order.length; i++) definitions.get(order[i])?.children?.forEach(cite);
          return [name, { mdx: true, valid: true, elements, headings, footnotes: order }];
        } catch (error) {
          return [name, { mdx: true, valid: false, error: error instanceof Error ? error.message : String(error), elements: [], headings: [], footnotes: [] }];
        }
      }),
    );
    fs.copyFileSync(file, path.join(outDir!, "mdx-notes.json"));
    fs.writeFileSync(path.join(outDir!, "mdx-expected.json"), JSON.stringify(expected, null, 2));
    expect(Object.keys(expected).length).toBe(notes.length);
  }, 60_000);

  it("writes the component helper cases and what the real functions answer", async () => {
    fs.mkdirSync(outDir!, { recursive: true });
    const file = path.resolve(__dirname, "../../ios/conformance/component-cases.json");
    const cases = JSON.parse(fs.readFileSync(file, "utf8")) as {
      chart: { type?: string; x?: string; y?: string; csv: string }[];
      repo: string[];
      youtube: { url: string; start?: string }[];
      start: string[];
      width: string[];
      imageRef: string[];
    };
    const mdxDir = path.resolve(__dirname, "../src/components/notes/mdx");
    const { parseChart } = await import(path.join(mdxDir, "chartData"));
    const { parseRepo } = await import(path.join(mdxDir, "repoRef"));
    const { parseYouTube, parseStart, youtubeEmbedUrl, youtubeWatchUrl } = await import(path.join(mdxDir, "youtubeRef"));
    const { parseImageWidth } = await import(path.join(mdxDir, "imageWidth"));
    const { imageNameFromRef } = await import(path.join(lib, "imageRefs"));

    const expected = {
      chart: cases.chart.map((input) => {
        const parsed = parseChart(input);
        if (!parsed.spec) return { error: parsed.error };
        const { type, x, y, rows } = parsed.spec;
        return { type, x, y, rows: rows.map((row: Record<string, string | number>) => ({ label: String(row[x]), values: Object.fromEntries(y.filter((name: string) => name in row).map((name: string) => [name, row[name]])) })) };
      }),
      repo: cases.repo.map((url) => parseRepo(url)),
      youtube: cases.youtube.map(({ url, start }) => {
        const ref = parseYouTube(url, start);
        return ref ? { ...ref, embed: youtubeEmbedUrl(ref), watch: youtubeWatchUrl(ref) } : null;
      }),
      start: cases.start.map((value) => parseStart(value)),
      width: cases.width.map((value) => parseImageWidth(value)),
      imageRef: cases.imageRef.map((value) => imageNameFromRef(value)),
    };
    fs.copyFileSync(file, path.join(outDir!, "component-cases.json"));
    fs.writeFileSync(path.join(outDir!, "component-expected.json"), JSON.stringify(expected, null, 2));
    expect(expected.repo.length).toBe(cases.repo.length);
  }, 60_000);

  it("writes the settings cases and what the real parseWebSettings makes of each", async () => {
    fs.mkdirSync(outDir!, { recursive: true });
    const file = path.resolve(__dirname, "../../ios/conformance/settings-cases.json");
    const cases = JSON.parse(fs.readFileSync(file, "utf8")) as { favorites: unknown[]; theme: unknown[]; location: unknown[] };
    const { parseWebSettings } = await import(path.join(lib, "webSettings"));
    const expected = {
      favorites: cases.favorites.map((value) => parseWebSettings({ favorites: value }).favorites),
      theme: cases.theme.map((value) => parseWebSettings({ theme: value }).theme),
      location: cases.location.map((value) => parseWebSettings({ location: value }).location ?? null),
    };
    fs.copyFileSync(file, path.join(outDir!, "settings-cases.json"));
    fs.writeFileSync(path.join(outDir!, "settings-expected.json"), JSON.stringify(expected, null, 2));
    expect(expected.favorites.length).toBe(cases.favorites.length);
  }, 60_000);

  it("writes the frontmatter cases and what the real frontmatter.ts makes of each", async () => {
    fs.mkdirSync(outDir!, { recursive: true });
    const file = path.resolve(__dirname, "../../ios/conformance/frontmatter-cases.json");
    const cases = JSON.parse(fs.readFileSync(file, "utf8")) as {
      parse: string[];
      generate: { title: string; createdAt: string; updatedAt: string; tags: string[]; description: string }[];
      header: { content: string; header: { image: string; layout: "full" | "centered" } | null; fallback: { title: string; createdAt: string; updatedAt: string } }[];
      tags: { toString: string[][]; fromString: string[] };
    };
    const fm = await import(path.join(lib, "frontmatter"));
    const expected = {
      parse: cases.parse.map((content) => {
        const [frontmatter, body] = fm.parse(content);
        return { frontmatter, body };
      }),
      generate: cases.generate.map(({ title, ...rest }) => fm.generate(title, rest)),
      header: cases.header.map(({ content, header, fallback }) => fm.withHeaderImage(content, header, fallback)),
      tags: { toString: cases.tags.toString.map((tags) => fm.tagsToString(tags)), fromString: cases.tags.fromString.map((text) => fm.tagsFromString(text)) },
    };
    fs.copyFileSync(file, path.join(outDir!, "frontmatter-cases.json"));
    fs.writeFileSync(path.join(outDir!, "frontmatter-expected.json"), JSON.stringify(expected, null, 2));
    expect(expected.parse.length).toBe(cases.parse.length);
  }, 60_000);

  // Needs a Meilisearch binary (COMPOSITION_MEILI_BIN, or `meilisearch` on the PATH), so it only runs when asked:
  //   IOS_REGENERATE_SEARCH=1 IOS_FIXTURE_DIR=<dir> ... -t "regenerates"   (apps/ios/scripts/regenerate-search-expected.sh)
  it.skipIf(!process.env.IOS_REGENERATE_SEARCH)("regenerates the committed Meilisearch answers", async () => {
    const queries = searchQueries();
    const corpora: Record<string, { hash: string; results: { query: string; ids: number[] }[] }> = {};
    let meilisearch = "";
    await withMeilisearch(async (server) => {
      meilisearch = server.version;
      for (const count of SEARCH_CORPUS_SIZES) {
        await withDesktop(async () => {
          await fillSearchCorpus(count);
          const search = await import(path.join(lib, "searchIndex"));
          const { listNotes } = await import(path.join(lib, "notesRepo"));
          search.configureSearch({ host: server.host, apiKey: server.apiKey });
          await search.reindexAll(listNotes());
          const results: { query: string; ids: number[] }[] = [];
          for (const query of queries) results.push({ query, ids: await search.searchNoteIds(query) });
          corpora[count] = { hash: await corpusHash(), results };
        });
      }
    });
    fs.writeFileSync(
      searchExpectedFile,
      JSON.stringify(
        {
          about: "What a real Meilisearch answered, through the desktop's own searchIndex.ts and searchQuery.ts, for each query in search-queries.json over the generated notes (see search-queries.json). Regenerate with apps/ios/scripts/regenerate-search-expected.sh; the conformance run fails if the notes or the queries no longer match these.",
          meilisearch,
          corpora,
        },
        null,
        1,
      ) + "\n",
    );
    expect(Object.keys(corpora)).toEqual(SEARCH_CORPUS_SIZES.map(String));
  }, 600_000);

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

        // What the desktop's service does after a restore (service.ts): the backup's settings replace the current ones.
        const { saveWebSettings } = await import(path.join(lib, "webSettings"));
        expect(staged.settings, "the iPad's backup carries the settings it was handed").not.toBeNull();
        saveWebSettings({ ...staged.settings, appDataDir: dataDir });
        const original = JSON.parse(fs.readFileSync(path.join(outDir!, `${name.replace("swift", "desktop")}.settings.json`), "utf8")) as Record<string, unknown>;
        const { appDataDir: _dir, dbPath: _db, favorites, ...kept } = loadWebSettings() as Record<string, unknown>;
        const { favorites: originalFavorites, ...originalKept } = original;
        expect(kept, "every key but the favorites is the desktop's own, unchanged").toEqual(originalKept);
        expect(originalFavorites).toEqual([
          { type: "note", id: 1 },
          { type: "group", id: 1 },
        ]);
        expect(favorites, "the favorites the iPad changed").toEqual([
          { type: "group", id: 1 },
          { type: "note", id: 2 },
        ]);

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

// --- The iPad's editor flow (build plan, Step 6) ------------------------------------------------------------------------------

const uiRunDir = process.env.IOS_UI_RUN_DIR;

/** Every row of the tables the editor flow touches, with the uuid of anything the starting database did not have replaced by "new". */
function flowRows(db: import("better-sqlite3").Database, startUuids: Set<string>): Record<string, unknown[]> {
  const rows: Record<string, unknown[]> = {};
  for (const table of ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups"]) {
    rows[table] = (db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Record<string, unknown>[]).map((row) =>
      typeof row.uuid === "string" && !startUuids.has(row.uuid) ? { ...row, uuid: "new" } : row,
    );
  }
  rows.sqlite_sequence = db.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all();
  return rows;
}

describe.skipIf(!uiRunDir)("iPad editor flow", () => {
  // apps/ios/scripts/editor-flow-test.sh runs the iPad app in the Simulator, makes a note, types into it, trashes it and restores it, and leaves
  // start.db, end.db and ui-run.json (the moments its rows record) in IOS_UI_RUN_DIR. This gives the real service the same operations.
  it("replays the operations the iPad's editor made, and every row is the same", async () => {
    const run = JSON.parse(fs.readFileSync(path.join(uiRunDir!, "ui-run.json"), "utf8")) as {
      noteId: number;
      createdAt: string;
      updatedAt: string;
      deletedAt: string;
      typed: string;
    };
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-ios-flow-"));
    fs.mkdirSync(path.join(home, ".composition"), { recursive: true });
    fs.copyFileSync(path.join(uiRunDir!, "start.db"), path.join(home, ".composition", "composition.db"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.resetModules();
    // Meilisearch isn't running; the service indexes best-effort (as in service.test.ts).
    vi.doMock(path.join(lib, "searchIndex"), () => ({
      indexNote: async () => {},
      deleteNoteFromIndex: async () => {},
      searchNoteIds: async () => [],
      unavailableMessage: () => "unavailable",
    }));
    const { default: Database } = await import("better-sqlite3");
    const startUuids = new Set<string>();
    const start = new Database(path.join(uiRunDir!, "start.db"), { readonly: true });
    for (const table of ["notes", "groups", "notebooks", "trashed_notes", "trashed_groups"]) {
      for (const row of start.prepare(`SELECT uuid FROM ${table}`).all() as { uuid: string }[]) startUuids.add(row.uuid);
    }
    start.close();

    const service = await import(path.join(lib, "service"));
    const { getDb, closeDb } = await import(path.join(lib, "db"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(run.createdAt));
    const created = await service.createNote("Untitled", null, null);
    expect(created.id).toBe(run.noteId);
    vi.setSystemTime(new Date(run.updatedAt));
    await service.saveNoteContent(created.id, created.content + run.typed);
    vi.setSystemTime(new Date(run.deletedAt));
    await service.deleteNote(created.id);
    await service.restoreNote(created.id);
    vi.useRealTimers();
    const desktop = flowRows(getDb(), startUuids);
    closeDb();

    const end = new Database(path.join(uiRunDir!, "end.db"), { readonly: true });
    const app = flowRows(end, startUuids);
    end.close();
    expect(app).toEqual(desktop);
    // And the note is really there, with what was typed.
    expect((app.notes as { id: number; content: string }[]).find((note) => note.id === run.noteId)?.content).toContain(run.typed.trim());
  }, 60_000);
});
