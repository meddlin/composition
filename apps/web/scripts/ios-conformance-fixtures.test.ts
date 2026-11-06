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
 *   search-corpus-100.db, search-corpus-1000.db, search-queries.json, search-parse-expected.json, search-expected.json
 *                                  spike S2: generated notes, the queries, what the real parseSearchQuery made of each, and
 *                                  (committed, not regenerated here) what a real Meilisearch answered for each
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
