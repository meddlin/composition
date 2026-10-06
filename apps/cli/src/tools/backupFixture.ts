import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { ATTACHMENT_DIR_NAME, IMAGE_DIR_NAME, loadWebSettings, saveWebSettings, searchIndex, service } from "../backend";

/**
 * The known data the manual backup and restore tests work with: a scratch "home" holding
 * notes, groups, a trashed note, an image, an attached file and non-default settings,
 * laid out the way each app lays out its own, plus a `fixture` record of exactly what
 * was put there, so `verifyFixture` can say whether a restore brought it all back.
 *
 * Never touches the real home: everything is under the folder it is given.
 */

/**
 * Keeps the fixture's notes out of any Meilisearch running on this machine, and a restore from
 * rebuilding a real index from them: writes would otherwise reach whatever listens on 7700.
 */
export function keepSearchOffline(): void {
  process.env.MEILI_URL = "http://127.0.0.1:1"; // a blocked port: requests fail at once
  process.env.MEILI_MASTER_KEY = "not-a-real-key";
  searchIndex.disableSearch("Search is off for the backup tests.");
}

export const APPS = ["cli", "web", "desktop"] as const;
export type App = (typeof APPS)[number];

const FIXTURE_FILE = "manual-backup-fixture.json";

/** Where each app keeps its settings file, relative to its home (see docs/product-builds.md). */
const SETTINGS_FILE: Record<App, string[]> = {
  cli: [".composition-cli", "settings.json"],
  web: [".composition-web", "settings.json"],
  desktop: ["userData", "settings.json"],
};

export const settingsFileFor = (app: App, home: string) => path.join(home, ...SETTINGS_FILE[app]);
export const dataDirFor = (home: string) => path.join(home, ".composition");

type Fixture = {
  app: App;
  home: string;
  settingsFile: string;
  notes: { id: number; title: string; sha: string }[];
  groups: { id: number; name: string; parentId: number | null }[];
  trashedNotes: { id: number; title: string }[];
  images: { name: string; sha: string }[];
  attachments: { id: number; noteId: number; fileName: string; storedName: string; sha: string }[];
  settings: { theme: string; city: string; sidebarWidth: number; editorRatio: number; favorites: { type: "note" | "group"; id: number }[] };
};

const sha = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");

/** A small, real PNG (blue, with an orange band), so it shows up in a preview and is easy to recognize. */
export function samplePng(width = 160, height = 80): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    const band = y > height / 3 && y < (2 * height) / 3;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = band ? [240, 150, 30] : [30, 100, 200];
      rows[row + 1 + x * 3] = r;
      rows[row + 2 + x * 3] = g;
      rows[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Points the shared data layer at this app's settings inside `home`. */
function useHome(app: App, home: string): void {
  process.env.COMPOSITION_SETTINGS_PATH = settingsFileFor(app, home);
}

/** Creates the fixture in a (new or empty) home and returns what it holds. */
export async function setupFixture(app: App, home: string): Promise<Fixture> {
  fs.mkdirSync(home, { recursive: true });
  if (fs.existsSync(path.join(home, FIXTURE_FILE)) || fs.existsSync(dataDirFor(home))) {
    throw new Error(`${home} already has Composition data. Pick a new folder, or delete it first.`);
  }
  useHome(app, home);
  const settingsFile = settingsFileFor(app, home);
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ appDataDir: dataDirFor(home), theme: "dark" }));

  const projects = await service.createGroup("Projects", null);
  const alpha = await service.createGroup("Alpha", projects.id);
  const welcome = await service.createNote("Welcome", null);
  const plan = await service.createNote("Alpha plan", alpha.id);
  const picture = await service.createNote("Picture note", projects.id);
  const report = await service.createNote("Report note", null);
  const deleted = await service.createNote("Deleted note", null);

  const fm = (title: string, tags: string) => `---\ntitle: ${title}\ndescription: ''\ntags: [${tags}]\n---\n`;
  await service.saveNoteContent(welcome.id, `${fm("Welcome", "")}This note was written by the backup test fixture.\n`);
  await service.saveNoteContent(plan.id, `${fm("Alpha plan", "plan, alpha")}# Alpha\n\n- [ ] Ship it\n- [ ] Back it up\n`);
  await service.saveNoteContent(report.id, `${fm("Report note", "")}The Quarterly report.txt file is attached to this note.\n`);
  await service.saveNoteContent(deleted.id, `${fm("Deleted note", "")}This one is in the Trash Can.\n`);

  const image = await service.saveImage({ noteId: picture.id, fileName: "diagram.png", data: samplePng() });
  if (!image.name) throw new Error(image.error ?? "could not store the sample image");
  await service.saveNoteContent(picture.id, `${fm("Picture note", "")}A blue picture with an orange band:\n\n![diagram](app_data/${image.name})\n`);

  const attachmentSource = path.join(home, "Quarterly report.txt");
  fs.writeFileSync(attachmentSource, "Quarterly report\nRevenue: up. Costs: down.\n");
  const attached = await service.addAttachmentFiles(report.id, [attachmentSource]);
  if (attached.error) throw new Error(attached.error);
  fs.rmSync(attachmentSource);

  await service.deleteNote(deleted.id);

  const settings = loadWebSettings();
  saveWebSettings({
    ...settings,
    theme: "forest",
    sidebarWidth: 300,
    editorRatio: 0.4,
    location: { name: "Austin, Texas, United States", latitude: 30.27, longitude: -97.74, timezone: "America/Chicago" },
    favorites: [{ type: "note", id: plan.id }],
  });

  const fixture = readFixtureFromDisk(app, home, settingsFile);
  fs.writeFileSync(path.join(home, FIXTURE_FILE), JSON.stringify(fixture, null, 2));
  return fixture;
}

/** What is on disk right now, in the fixture's own shape. Reads the database read-only, so the app may be running. */
function readFixtureFromDisk(app: App, home: string, settingsFile: string): Fixture {
  const dataDir = dataDirFor(home);
  const db = new Database(path.join(dataDir, "composition.db"), { readonly: true, fileMustExist: true });
  try {
    const table = (name: string) => {
      try {
        return db.prepare(`SELECT * FROM ${name} ORDER BY id`).all() as Record<string, unknown>[];
      } catch {
        return [];
      }
    };
    const folder = (name: string) => {
      try {
        return fs.readdirSync(path.join(dataDir, name)).filter((n) => !n.startsWith(".")).sort();
      } catch {
        return [];
      }
    };
    const stored = new Map(table("attachments").map((r) => [r.stored_name as string, r]));
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    return {
      app,
      home,
      settingsFile,
      notes: table("notes").map((r) => ({ id: r.id as number, title: r.title as string, sha: sha(r.content as string) })),
      groups: table("groups").map((r) => ({ id: r.id as number, name: r.name as string, parentId: r.parent_id as number | null })),
      trashedNotes: table("trashed_notes").map((r) => ({ id: r.id as number, title: r.title as string })),
      images: folder(IMAGE_DIR_NAME).map((name) => ({ name, sha: sha(fs.readFileSync(path.join(dataDir, IMAGE_DIR_NAME, name))) })),
      attachments: folder(ATTACHMENT_DIR_NAME).map((storedName) => {
        const row = stored.get(storedName);
        return {
          id: (row?.id as number) ?? -1,
          noteId: (row?.note_id as number) ?? -1,
          fileName: (row?.file_name as string) ?? "",
          storedName,
          sha: sha(fs.readFileSync(path.join(dataDir, ATTACHMENT_DIR_NAME, storedName))),
        };
      }),
      settings: {
        theme: settings.theme,
        city: settings.location?.name ?? "",
        sidebarWidth: settings.sidebarWidth,
        editorRatio: settings.editorRatio,
        favorites: settings.favorites ?? [],
      },
    };
  } finally {
    db.close();
  }
}

export function loadFixture(home: string): Fixture {
  const file = path.join(home, FIXTURE_FILE);
  if (!fs.existsSync(file)) throw new Error(`No test data in ${home}. Run "setup" first.`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Fixture;
}

/**
 * Simulates losing everything: deletes the database, the images and the attached files, and puts
 * the settings back to their defaults. The app must be closed (a running one holds the database).
 */
export function wipeFixture(home: string, { force = false }: { force?: boolean } = {}): void {
  const fixture = loadFixture(home);
  const dataDir = dataDirFor(home);
  const wal = path.join(dataDir, "composition.db-wal");
  if (!force && fs.existsSync(wal) && fs.statSync(wal).size > 0) {
    throw new Error("The database looks open (there is a -wal file beside it). Quit the app first, or pass --force.");
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(path.join(dataDir, `composition.db${suffix}`), { force: true });
  fs.rmSync(path.join(dataDir, IMAGE_DIR_NAME), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir, ATTACHMENT_DIR_NAME), { recursive: true, force: true });
  fs.writeFileSync(fixture.settingsFile, JSON.stringify({ appDataDir: dataDir, theme: "dark" }));
}

export type Check = { name: string; ok: boolean; detail?: string };

/** Compares what is on disk now with what `setupFixture` put there. */
export function verifyFixture(home: string): Check[] {
  const expected = loadFixture(home);
  const dataDir = dataDirFor(home);
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  if (!fs.existsSync(path.join(dataDir, "composition.db"))) {
    check("the database exists", false, "no composition.db");
    return checks;
  }
  const actual = readFixtureFromDisk(expected.app, home, expected.settingsFile);
  const titles = (items: { title: string }[]) => items.map((i) => i.title).sort().join(", ") || "none";
  const same = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

  const idAndTitle = (notes: { id: number; title: string }[]) => notes.map(({ id, title }) => ({ id, title }));
  check(`notes: ${titles(expected.notes)}`, same(idAndTitle(expected.notes), idAndTitle(actual.notes)), `found: ${titles(actual.notes)}`);
  check("every note's text is byte-for-byte the same", same(expected.notes.map((n) => n.sha), actual.notes.map((n) => n.sha)));
  check("groups, and how they nest", same(expected.groups, actual.groups), `found ${actual.groups.map((g) => g.name).join(", ") || "none"}`);
  check(`the Trash Can: ${titles(expected.trashedNotes)}`, same(expected.trashedNotes, actual.trashedNotes), `found: ${titles(actual.trashedNotes)}`);
  check(`images: ${expected.images.map((i) => i.name).join(", ")}`, same(expected.images, actual.images), `found ${actual.images.length}`);
  check(
    `attachments: ${expected.attachments.map((a) => a.fileName).join(", ")}`,
    same(expected.attachments, actual.attachments),
    `found ${actual.attachments.map((a) => a.fileName || a.storedName).join(", ") || "none"}`,
  );
  check("settings: color scheme, city, column sizes and favorites", same(expected.settings, actual.settings), JSON.stringify(actual.settings));
  const settings = JSON.parse(fs.readFileSync(expected.settingsFile, "utf-8"));
  check("the data location was left alone", settings.appDataDir === dataDir && !settings.dbPath, String(settings.appDataDir));
  const strays = fs.readdirSync(dataDir).filter((n) => n.startsWith(".restore-") || n.startsWith(".composition-backup-"));
  check("no scratch folders were left behind", strays.length === 0, strays.join(", "));
  return checks;
}

/** What `inspect` reports about a backup file, checked against the fixture when `home` has one. */
export async function inspectBackup(file: string, home?: string): Promise<{ lines: string[]; checks: Check[] }> {
  const { readArchive } = await import("../backend");
  const entries: { name: string; size: number }[] = [];
  let manifest: { version?: number; createdAt?: string; counts?: Record<string, number> } = {};
  let settings: Record<string, unknown> = {};
  await readArchive(file, async ({ name, size, data }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of data) if (name.endsWith(".json")) chunks.push(chunk);
    if (name === "composition-backup.json") manifest = JSON.parse(Buffer.concat(chunks).toString());
    if (name === "settings.json") settings = JSON.parse(Buffer.concat(chunks).toString());
    entries.push({ name, size });
  });
  const lines = [
    `${file}  (${fs.statSync(file).size} bytes)`,
    `format version ${manifest.version}, made ${manifest.createdAt}`,
    `counts: ${JSON.stringify(manifest.counts)}`,
    ...entries.map((e) => `  ${String(e.size).padStart(9)}  ${e.name}`),
  ];
  const checks: Check[] = [];
  if (home && fs.existsSync(path.join(home, FIXTURE_FILE))) {
    const expected = loadFixture(home);
    const has = (name: string) => entries.some((e) => e.name === name);
    const counts = manifest.counts ?? {};
    checks.push(
      { name: "the backup counts the fixture's notes and groups", ok: counts.notes === expected.notes.length && counts.groups === expected.groups.length, detail: JSON.stringify(counts) },
      { name: "the backup counts the Trash Can's note", ok: counts.trashedNotes === expected.trashedNotes.length },
      { name: "the backup holds the database", ok: has("composition.db") },
      { name: "the backup holds every image", ok: expected.images.every((i) => has(`${IMAGE_DIR_NAME}/${i.name}`)) },
      { name: "the backup holds every attached file", ok: expected.attachments.every((a) => has(`${ATTACHMENT_DIR_NAME}/${a.storedName}`)) },
      { name: "the backup holds the settings", ok: settings.theme === expected.settings.theme },
      { name: "the backup does not hold this machine's data location", ok: !("appDataDir" in settings) && !("dbPath" in settings) },
    );
  }
  return { lines, checks };
}
