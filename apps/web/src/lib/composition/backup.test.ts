import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Meilisearch isn't running in tests; the service indexes best-effort, so a stub keeps this quiet.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  reindexAll: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "unavailable",
}));

// A real 1x1 PNG, so the service accepts it as an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let home: string;
let backups: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-backup-"));
  backups = path.join(home, "backups");
  vi.stubEnv("HOME", home);
  vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(home, "settings.json"));
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const dataDir = () => path.join(home, ".composition");

/** Notes, a group, a trashed note, an image, an attachment and non-default settings. */
async function populate() {
  const service = await import("./service");
  const settings = await import("./webSettings");
  const group = await service.createGroup("Projects", null);
  const first = await service.createNote("First note", group.id);
  const second = await service.createNote("Second note", null);
  const trashed = await service.createNote("Trashed note", null);
  await service.saveNoteContent(first.id, "---\ntitle: First note\ndescription: ''\ntags: []\n---\nHello.");
  await service.deleteNote(trashed.id);

  const image = await service.saveImage({ noteId: first.id, fileName: "pic.png", data: PNG });
  const attachmentSource = path.join(home, "Quarterly report.pdf");
  fs.writeFileSync(attachmentSource, "%PDF-1.7 report");
  const attached = await service.addAttachmentFiles(second.id, [attachmentSource]);

  await service.saveTheme("forest");
  await service.saveFavorites([{ type: "note", id: first.id }]);
  settings.saveWebSettings({
    ...settings.loadWebSettings(),
    sidebarWidth: 333,
    sunHours: { lightenFrom: "06:00", lightFrom: "07:00", darkenFrom: "18:30", darkFrom: "20:00" },
  });
  return { service, settings, group, first, second, trashed, image, attached };
}

describe("createBackup", () => {
  it("writes one timestamped .tar.gz into the folder, and says what is in it", async () => {
    const { service } = await populate();

    const result = await service.createBackup(backups);

    expect(result.error).toBeUndefined();
    expect(path.dirname(result.file!)).toBe(backups);
    expect(path.basename(result.file!)).toMatch(/^composition-backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/);
    expect(fs.statSync(result.file!).size).toBe(result.bytes);
    expect(result.counts).toEqual({ notes: 2, groups: 1, trashedNotes: 1, trashedGroups: 0, images: 1, attachments: 1, documents: 0, todos: 0, archivedTodos: 0, contacts: 0 });
    // Only the backup is left in the folder, none of the working files.
    expect(fs.readdirSync(backups)).toEqual([path.basename(result.file!)]);
  });

  it("counts the to-dos on the list and the archived ones apart", async () => {
    const { service } = await populate();
    const repo = await import("./todosRepo");
    const trip = repo.addTodo("Plan trip", null);
    repo.addTodo("Book flights", trip.id);
    const idea = repo.addTodo("Old idea", null);
    repo.archiveTodoTree(idea.id, "removed", 0);

    const result = await service.createBackup(backups);

    expect(result.counts).toMatchObject({ todos: 2, archivedTodos: 1 });
  });

  it("is an ordinary tar.gz with the database, images, attachments and settings in it", async () => {
    const { service, image } = await populate();
    const { file } = await service.createBackup(backups);

    const names = execFileSync("tar", ["-tzf", file!], { encoding: "utf-8" }).trim().split("\n").sort();

    expect(names.slice(0, 4)).toEqual(["app_data/" + image.name, "attachments/" + names[1].slice("attachments/".length), "composition-backup.json", "composition.db"]);
    expect(names[1]).toMatch(/^attachments\/[0-9a-f]{12}-Quarterly_report\.pdf$/);
    expect(names[4]).toBe("settings.json");
    expect(names).toHaveLength(5);
  });

  it("does not carry the data location, which belongs to this machine", async () => {
    const { service } = await populate();
    const { file } = await service.createBackup(backups);

    const settings = JSON.parse(execFileSync("tar", ["-xzOf", file!, "settings.json"], { encoding: "utf-8" }));

    expect(settings).toMatchObject({ theme: "forest", sidebarWidth: 333, sunHours: { lightenFrom: "06:00", darkFrom: "20:00" } });
    // The city an older version kept is not written any more.
    expect(settings).not.toHaveProperty("location");
    expect(settings).not.toHaveProperty("appDataDir");
    expect(settings).not.toHaveProperty("dbPath");
  });

  it("carries the AI helper's server address and context size, which are not tied to this machine's files", async () => {
    const { service, settings } = await populate();
    settings.saveWebSettings({
      ...settings.loadWebSettings(),
      assistant: { serverUrl: "http://nas:11434", contextTokens: 16384 },
    });
    const { file } = await service.createBackup(backups);

    const saved = JSON.parse(execFileSync("tar", ["-xzOf", file!, "settings.json"], { encoding: "utf-8" }));

    expect(saved.assistant).toEqual({ serverUrl: "http://nas:11434", contextTokens: 16384 });
  });

  it("expands ~ and refuses a relative folder", async () => {
    const { service } = await populate();

    const ok = await service.createBackup("~/somewhere");
    const relative = await service.createBackup("somewhere/else");
    const empty = await service.createBackup("  ");

    expect(ok.file).toContain(path.join(home, "somewhere"));
    expect(relative.error).toMatch(/full path/);
    expect(empty.error).toMatch(/Enter/);
  });

  it("backs up a brand-new install with nothing in it", async () => {
    const service = await import("./service");

    const result = await service.createBackup(backups);

    expect(result.counts).toEqual({ notes: 0, groups: 0, trashedNotes: 0, trashedGroups: 0, images: 0, attachments: 0, documents: 0, todos: 0, archivedTodos: 0, contacts: 0 });
  });

  it("does not let two run at once", async () => {
    const { service } = await populate();

    const [a, b] = await Promise.all([service.createBackup(backups), service.createBackup(backups)]);

    expect([a.error, b.error].filter(Boolean)).toEqual(["Another backup or restore is already running."]);
  });
});

describe("restoreBackup", () => {
  it("brings back notes, groups, the Trash Can, images, attachments and settings after they are lost", async () => {
    const { service, settings, group, first, second, trashed, image, attached } = await populate();
    const { file } = await service.createBackup(backups);

    // Lose everything: delete the data folder, and change the settings.
    const { closeDb } = await import("./db");
    closeDb();
    fs.rmSync(dataDir(), { recursive: true });
    await service.saveTheme("light");
    await service.saveFavorites([]);

    const result = await service.restoreBackup(file!);

    expect(result.error).toBeUndefined();
    expect(result.counts).toEqual({ notes: 2, groups: 1, trashedNotes: 1, trashedGroups: 0, images: 1, attachments: 1, documents: 0, todos: 0, archivedTodos: 0, contacts: 0 });
    const workspace = await service.loadWorkspace();
    expect(workspace.notes.map((n) => n.title).sort()).toEqual(["First note", "Second note"]);
    expect(workspace.notes.find((n) => n.id === first.id)).toMatchObject({ groupId: group.id });
    expect(workspace.notes.find((n) => n.id === first.id)!.content).toContain("Hello.");
    expect(workspace.groups.map((g) => g.name)).toEqual(["Projects"]);
    expect((await service.loadTrash()).notes.map((n) => n.id)).toEqual([trashed.id]);
    expect(fs.readFileSync(path.join(dataDir(), "app_data", image.name!)).equals(PNG)).toBe(true);
    const [attachment] = await service.listAttachments(second.id);
    expect(attachment.id).toBe(attached.attachments[0].id);
    const stored = await service.findAttachmentFile(attachment.id);
    expect(fs.readFileSync(stored!.path, "utf-8")).toBe("%PDF-1.7 report");
    expect(settings.loadWebSettings()).toMatchObject({
      theme: "forest",
      sidebarWidth: 333,
      favorites: [{ type: "note", id: first.id }],
      sunHours: { lightenFrom: "06:00", lightFrom: "07:00", darkenFrom: "18:30", darkFrom: "20:00" },
    });
  });

  it("brings back the to-dos, the archive, the activity log, the report links and the to-do settings", async () => {
    const { service, settings, first } = await populate();
    const repo = await import("./todosRepo");
    const { getDb, closeDb } = await import("./db");
    const trip = repo.addTodo("Plan trip", null, new Date(2026, 9, 26, 9, 0));
    repo.addTodo("Book flights", trip.id, new Date(2026, 9, 26, 9, 5));
    const sent = repo.addTodo("Send report", null, new Date(2026, 9, 26, 9, 10));
    repo.updateTodo(sent.id, { done: true }, new Date(2026, 9, 27, 16, 30));
    const idea = repo.addTodo("Old idea", null, new Date(2026, 9, 26, 9, 15));
    repo.archiveTodoTree(idea.id, "removed", 0, new Date(2026, 9, 28, 8, 0));
    repo.markWeekClosed({ start: "2026-10-25", end: "2026-10-31" }, new Date(2026, 10, 1, 9, 0));
    getDb()
      .prepare("INSERT INTO todo_reports (kind, period_start, period_end, note_id, generated_at) VALUES ('week', '2026-10-25', '2026-10-31', ?, ?)")
      .run(first.id, "2026-11-01T14:03:00.000Z");
    const cycle = { weekStartsOn: 1, retentionMonths: null, fiscalYearStartMonth: 10 } as const;
    settings.saveWebSettings({ ...settings.loadWebSettings(), todos: cycle });

    const snapshot = () => ({
      live: repo.listTodos(),
      archived: repo.listArchivedTodos(),
      events: repo.listTodoEvents(),
      closed: getDb().prepare("SELECT kind, period_start, period_end, closed_at FROM todo_closed").all(),
      reports: getDb().prepare("SELECT kind, period_start, period_end, note_id, generated_at FROM todo_reports").all(),
    });
    const before = snapshot();
    expect(before.live).toHaveLength(3);
    expect(before.archived).toHaveLength(1);
    expect(before.events.length).toBeGreaterThan(5);
    const { file } = await service.createBackup(backups);

    // Lose everything, and change the to-do settings.
    closeDb();
    fs.rmSync(dataDir(), { recursive: true });
    settings.saveWebSettings({ ...settings.loadWebSettings(), todos: { weekStartsOn: 0, retentionMonths: 60, fiscalYearStartMonth: 1 } });

    const result = await service.restoreBackup(file!);

    expect(result.error).toBeUndefined();
    expect(result.counts).toMatchObject({ todos: 3, archivedTodos: 1 });
    expect(snapshot()).toEqual(before);
    expect(settings.loadWebSettings().todos).toEqual(cycle);
    // The report link still points at a note that came back with it.
    expect((await service.loadWorkspace()).notes.map((n) => n.id)).toContain(first.id);
  });

  it("counts the contacts, and brings them back in full after everything is lost", async () => {
    const { service } = await populate();
    const contacts = await import("./contactsService");
    const { closeDb } = await import("./db");
    await contacts.addContact({ kind: "personal", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "555 0100", notes: "Met at a conference.\nLikes maths.", birthDate: "1985-12-10", title: "", manager: "" });
    await contacts.addContact({ kind: "work", firstName: "Grace", lastName: "Hopper", email: "", phone: "", notes: "", birthDate: "", title: "Rear Admiral", manager: "Chester Nimitz" });
    const before = await contacts.listContacts();
    const { file, counts } = await service.createBackup(backups);
    expect(counts).toMatchObject({ contacts: 2 });

    closeDb();
    fs.rmSync(dataDir(), { recursive: true });
    expect(await contacts.listContacts()).toEqual([]);

    const result = await service.restoreBackup(file!);

    expect(result.error).toBeUndefined();
    expect(result.counts).toMatchObject({ contacts: 2 });
    expect(await contacts.listContacts()).toEqual(before);
  });

  it("restores a backup made before contacts existed, leaving an empty rolodex that can be added to", async () => {
    const { service } = await populate();
    const contacts = await import("./contactsService");
    const { file } = await service.createBackup(backups);
    const { getDb } = await import("./db");
    // The backup above has the table; make one that does not, as a backup from before this plugin does.
    const Database = (await import("better-sqlite3")).default;
    const old = path.join(home, "no-contacts.db");
    getDb().prepare("VACUUM INTO ?").run(old);
    const raw = new Database(old);
    raw.exec("DROP TABLE contacts");
    raw.close();
    const { writeArchive } = await import("./tarArchive");
    const legacy = path.join(home, "no-contacts.tar.gz");
    const manifest = { format: "composition-backup", version: 1, createdAt: "2026-09-01T00:00:00.000Z", counts: {} };
    await writeArchive(legacy, new Map([["composition-backup.json", Buffer.from(JSON.stringify(manifest))]]), [{ name: "composition.db", file: old }]);
    expect(file).toBeTruthy();

    const result = await service.restoreBackup(legacy);

    expect(result.error).toBeUndefined();
    expect(result.counts).toMatchObject({ contacts: 0 });
    expect(await contacts.listContacts()).toEqual([]);
    expect((await contacts.addContact({ kind: "personal", firstName: "Ada", lastName: "", email: "", phone: "", notes: "", birthDate: "", title: "", manager: "" })).firstName).toBe("Ada");
  });

  it("replaces what is there now rather than merging with it", async () => {
    const { service, second } = await populate();
    const { file } = await service.createBackup(backups);
    const after = await service.createNote("Written after the backup", null);
    const extra = path.join(dataDir(), "app_data", "added-later-aaaaaaaaaaaa.png");
    fs.writeFileSync(extra, PNG);
    await service.removeAttachment((await service.listAttachments(second.id))[0].id);

    const result = await service.restoreBackup(file!);

    expect(result.error).toBeUndefined();
    const titles = (await service.loadWorkspace()).notes.map((n) => n.title);
    expect(titles).not.toContain(after.title);
    expect(fs.existsSync(extra)).toBe(false);
    expect(await service.listAttachments(second.id)).toHaveLength(1);
    expect(fs.readdirSync(path.join(dataDir(), "attachments"))).toHaveLength(1);
  });

  it("saves what it replaces first, so a restore can itself be undone", async () => {
    const { service } = await populate();
    const { file } = await service.createBackup(backups);
    const after = await service.createNote("Written after the backup", null);

    const result = await service.restoreBackup(file!);

    expect(path.dirname(result.safetyBackup!)).toBe(path.join(home, "Composition Backups"));
    expect(path.basename(result.safetyBackup!)).toMatch(/^composition-pre-restore-/);
    const undone = await service.restoreBackup(result.safetyBackup!);
    expect(undone.error).toBeUndefined();
    expect((await service.loadWorkspace()).notes.map((n) => n.title)).toContain(after.title);
  });

  it("keeps this machine's data location when the backup came from another", async () => {
    const { service, settings } = await populate();
    const { file } = await service.createBackup(backups);
    const elsewhere = path.join(home, "elsewhere");
    await service.saveSettings({ appDataDir: elsewhere, dbPath: "" });

    const result = await service.restoreBackup(file!);

    expect(result.error).toBeUndefined();
    expect(settings.loadWebSettings().appDataDir).toBe(elsewhere);
    expect(fs.existsSync(path.join(elsewhere, "composition.db"))).toBe(true);
    expect((await service.loadWorkspace()).notes).toHaveLength(2);
    expect(fs.readdirSync(elsewhere).filter((n) => n.startsWith(".restore-"))).toEqual([]);
  });

  it("rebuilds the search index from the restored notes", async () => {
    const { service } = await populate();
    const { file } = await service.createBackup(backups);
    const searchIndex = await import("./searchIndex");
    vi.mocked(searchIndex.reindexAll).mockClear();

    await service.restoreBackup(file!);

    expect(searchIndex.reindexAll).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchIndex.reindexAll).mock.calls[0][0].map((n) => n.title).sort()).toEqual(["First note", "Second note"]);
  });

  it("still restores when search is down", async () => {
    const { service } = await populate();
    const { file } = await service.createBackup(backups);
    const searchIndex = await import("./searchIndex");
    vi.mocked(searchIndex.reindexAll).mockRejectedValueOnce(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await service.restoreBackup(file!)).error).toBeUndefined();
  });

  it("restores a backup made before the Trash Can and attachments existed", async () => {
    const service = await import("./service");
    const Database = (await import("better-sqlite3")).default;
    const old = path.join(home, "old.db");
    const db = new Database(old);
    db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO notes (title, content, created_at, updated_at) VALUES ('Ancient', 'old', '2020-01-01', '2020-01-01');`);
    db.close();
    const { writeArchive } = await import("./tarArchive");
    const file = path.join(home, "old.tar.gz");
    const manifest = { format: "composition-backup", version: 1, createdAt: "2020-01-01T00:00:00.000Z", counts: {} };
    await writeArchive(file, new Map([["composition-backup.json", Buffer.from(JSON.stringify(manifest))]]), [
      { name: "composition.db", file: old },
    ]);

    const result = await service.restoreBackup(file);

    expect(result.error).toBeUndefined();
    expect(result.counts).toMatchObject({ todos: 0, archivedTodos: 0, contacts: 0 });
    expect((await service.loadWorkspace()).notes.map((n) => n.title)).toEqual(["Ancient"]);
  });

  it("restores a backup made before the weekly cycle, counting its to-dos as live ones", async () => {
    const service = await import("./service");
    const Database = (await import("better-sqlite3")).default;
    const old = path.join(home, "old-todos.db");
    const db = new Database(old);
    db.exec(`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER, title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO todos (title, done, created_at, updated_at) VALUES ('open', 0, '', ''), ('closed', 1, '', '');`);
    db.close();
    const { writeArchive } = await import("./tarArchive");
    const file = path.join(home, "old-todos.tar.gz");
    const manifest = { format: "composition-backup", version: 1, createdAt: "2026-09-01T00:00:00.000Z", counts: {} };
    await writeArchive(file, new Map([["composition-backup.json", Buffer.from(JSON.stringify(manifest))]]), [
      { name: "composition.db", file: old },
    ]);

    const result = await service.restoreBackup(file);

    expect(result.error).toBeUndefined();
    expect(result.counts).toMatchObject({ todos: 2, archivedTodos: 0 });
    const repo = await import("./todosRepo");
    expect(repo.listTodos().map((t) => [t.title, t.status])).toEqual([
      ["open", "todo"],
      ["closed", "done"],
    ]);
  });
});

describe("restoreBackup refuses, and changes nothing", () => {
  /** Builds an archive from (name, bytes) pairs, with a valid manifest and database unless told otherwise. */
  async function craft(extra: [string, Buffer][], options: { manifest?: unknown; omitDatabase?: boolean } = {}) {
    const { writeArchive } = await import("./tarArchive");
    const service = await import("./service");
    const real = await service.createBackup(path.join(home, "seed"));
    const database = path.join(home, "seed.db");
    fs.writeFileSync(database, execFileSync("tar", ["-xzOf", real.file!, "composition.db"], { maxBuffer: 1 << 26 }));
    const manifest = options.manifest ?? { format: "composition-backup", version: 1, createdAt: "2026-01-01T00:00:00.000Z", counts: {} };
    const file = path.join(home, `crafted-${crypto.randomBytes(3).toString("hex")}.tar.gz`);
    const scratch = extra.map(([name, bytes]) => {
      const f = path.join(home, `x-${crypto.randomBytes(3).toString("hex")}`);
      fs.writeFileSync(f, bytes);
      return { name, file: f };
    });
    await writeArchive(file, new Map([["composition-backup.json", Buffer.from(JSON.stringify(manifest))]]), [
      ...(options.omitDatabase ? [] : [{ name: "composition.db", file: database }]),
      ...scratch,
    ]);
    return file;
  }

  async function expectUntouched(service: typeof import("./service"), before: string[]) {
    expect((await service.loadWorkspace()).notes.map((n) => n.title).sort()).toEqual(before);
    const leftovers = fs.readdirSync(dataDir()).filter((n) => n.startsWith(".restore-"));
    expect(leftovers).toEqual([]);
  }

  it("a file that is not a backup", async () => {
    const { service } = await populate();
    const junk = path.join(home, "junk.tar.gz");
    fs.writeFileSync(junk, crypto.randomBytes(5000));

    const result = await service.restoreBackup(junk);

    expect(result.error).toMatch(/not a Composition backup/);
    await expectUntouched(service, ["First note", "Second note"]);
  });

  it("a file that does not exist", async () => {
    const { service } = await populate();
    expect((await service.restoreBackup(path.join(home, "nope.tar.gz"))).error).toMatch(/Can't read/);
    await expectUntouched(service, ["First note", "Second note"]);
  });

  it("a path that climbs out of the folder", async () => {
    const { service } = await populate();
    const file = await craft([["app_data/../../escaped.png", PNG]]);

    const result = await service.restoreBackup(file);

    expect(result.error).toMatch(/doesn't know/);
    expect(fs.existsSync(path.join(home, "escaped.png"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir(), "escaped.png"))).toBe(false);
    await expectUntouched(service, ["First note", "Second note"]);
  });

  it("an absolute path, a stray file, and an image folder entry that is not an image", async () => {
    const { service } = await populate();
    for (const name of ["/tmp/escaped.png", "meili.log", "app_data/script.html", "app_data/sub/pic.png", "attachments/.hidden", "documents/.hidden", "documents/sub/book.pdf", "documents/../../escaped.pdf"]) {
      const result = await service.restoreBackup(await craft([[name, Buffer.from("x")]]));
      expect(result.error, name).toMatch(/doesn't know/);
    }
    await expectUntouched(service, ["First note", "Second note"]);
  });

  it("a backup from a newer version of the app", async () => {
    const { service } = await populate();
    const file = await craft([], { manifest: { format: "composition-backup", version: 99, createdAt: "x", counts: {} } });

    expect((await service.restoreBackup(file)).error).toMatch(/newer version/);
    await expectUntouched(service, ["First note", "Second note"]);
  });

  it("an archive with no description of itself, or no database", async () => {
    const { service } = await populate();
    expect((await service.restoreBackup(await craft([], { manifest: { hello: 1 } }))).error).toMatch(/not a Composition backup/);
    expect((await service.restoreBackup(await craft([], { omitDatabase: true }))).error).toMatch(/no database/);
    await expectUntouched(service, ["First note", "Second note"]);
  });

  it("a database that is damaged", async () => {
    const { service } = await populate();
    const file = await craft([]);
    const { writeArchive } = await import("./tarArchive");
    const garbage = path.join(home, "garbage.db");
    fs.writeFileSync(garbage, crypto.randomBytes(8192));
    const bad = path.join(home, "bad.tar.gz");
    const manifest = { format: "composition-backup", version: 1, createdAt: "x", counts: {} };
    await writeArchive(bad, new Map([["composition-backup.json", Buffer.from(JSON.stringify(manifest))]]), [{ name: "composition.db", file: garbage }]);

    expect((await service.restoreBackup(bad)).error).toMatch(/database/);
    expect(fs.existsSync(file)).toBe(true);
    await expectUntouched(service, ["First note", "Second note"]);
  });

  it("a backup with a link in it", async () => {
    const { service } = await populate();
    const folder = path.join(home, "linkdir");
    fs.mkdirSync(folder);
    fs.symlinkSync("/etc/passwd", path.join(folder, "composition.db"));
    const file = path.join(home, "link.tar.gz");
    execFileSync("tar", ["-czf", file, "-C", folder, "composition.db"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });

    expect((await service.restoreBackup(file)).error).toMatch(/other than files/);
    await expectUntouched(service, ["First note", "Second note"]);
  });
});

describe("applyStagedBackup", () => {
  it("puts the previous data back if it fails halfway", async () => {
    const service = await import("./service");
    const backup = await import("./backup");
    await service.createNote("Keep me", null);
    const { closeDb } = await import("./db");
    closeDb();
    const images = path.join(dataDir(), "app_data");
    fs.mkdirSync(images);
    fs.writeFileSync(path.join(images, "mine-aaaaaaaaaaaa.png"), PNG);
    // A staged backup whose database file is missing: the swap fails after the old data was moved aside.
    const dir = fs.mkdtempSync(path.join(dataDir(), ".restore-"));
    fs.mkdirSync(path.join(dir, "app_data"));
    fs.writeFileSync(path.join(dir, "app_data", "theirs-bbbbbbbbbbbb.png"), PNG);

    expect(() =>
      backup.applyStagedBackup(
        { dir, createdAt: "x", counts: {} as never, settings: null, hasImages: true, hasAttachments: false, hasDocuments: false },
        { appDataDir: dataDir(), dbPath: path.join(dataDir(), "composition.db") },
      ),
    ).toThrow(/previous data was put back/);

    expect(fs.readdirSync(images)).toEqual(["mine-aaaaaaaaaaaa.png"]);
    expect((await service.loadWorkspace()).notes.map((n) => n.title)).toEqual(["Keep me"]);
  });
});

describe("a PDF in a backup", () => {
  /** `populate`, and the first note owns a PDF with a highlight, an ink page and a bookmark. */
  async function populateWithPdf() {
    const context = await populate();
    const documents = await import("./documents");
    const marks = await import("./pdfMarkupRepo");
    const source = path.join(home, "Designing Data.pdf");
    fs.writeFileSync(source, "%PDF-1.7 textbook");
    const result = await documents.importDocument(dataDir(), context.first.id, source, { pageCount: 8 });
    if (result.status !== "added") throw new Error("expected the PDF to be imported");
    const highlight = marks.addAnnotation(result.document.id, { page: 3, kind: "highlight", color: "green", rects: [[72, 600, 300, 620]], quote: "a line", comment: "check" });
    const ink = marks.addAnnotation(result.document.id, { page: 5, kind: "ink", color: "black", body: { strokes: [[[1, 2], [3, 4]]] } });
    const bookmark = marks.addBookmark(result.document.id, 7, "Chapter 7");
    return { ...context, document: result.document, highlight, ink, bookmark, marks };
  }

  it("is in the archive under documents/, and counted", async () => {
    const { service, document } = await populateWithPdf();

    const result = await service.createBackup(backups);

    expect(result.counts).toMatchObject({ documents: 1, attachments: 1 });
    const names = execFileSync("tar", ["-tzf", result.file!], { encoding: "utf-8" }).trim().split("\n");
    expect(names).toContain(`documents/${document.storedName}`);
    expect(names).toHaveLength(6);
  });

  it("comes back with its file, its uuid, its marks and its bookmark after everything is lost", async () => {
    const { service, first, document, highlight, ink, bookmark, marks } = await populateWithPdf();
    const { file } = await service.createBackup(backups);
    const { closeDb } = await import("./db");
    closeDb();
    fs.rmSync(dataDir(), { recursive: true });

    const result = await service.restoreBackup(file!);

    expect(result.error).toBeUndefined();
    expect(result.counts).toMatchObject({ documents: 1 });
    const documents = await import("./documentsRepo");
    expect(documents.getDocumentForNote(first.id)).toEqual(document);
    expect(fs.readFileSync(path.join(dataDir(), "documents", document.storedName), "utf-8")).toBe("%PDF-1.7 textbook");
    expect(marks.listAnnotations(document.id)).toEqual([highlight, ink]);
    expect(marks.listBookmarks(document.id)).toEqual([bookmark]);
  });

  it("is replaced, not merged, when a backup without it is restored, and the safety backup keeps it", async () => {
    const { service, first } = await populate();
    const before = await service.createBackup(path.join(home, "before"));
    const documents = await import("./documents");
    const source = path.join(home, "later.pdf");
    fs.writeFileSync(source, "%PDF-1.7 later");
    const added = await documents.importDocument(dataDir(), first.id, source);
    if (added.status !== "added") throw new Error("expected the PDF to be imported");

    const result = await service.restoreBackup(before.file!);

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(dataDir(), "documents", added.document.storedName))).toBe(false);
    expect((await import("./documentsRepo")).getDocumentForNote(first.id)).toBeNull();
    const kept = execFileSync("tar", ["-tzf", result.safetyBackup!], { encoding: "utf-8" });
    expect(kept).toContain(`documents/${added.document.storedName}`);
  });

  it("is taken into account when deciding whether there is current data to keep a safety backup of", async () => {
    const service = await import("./service");
    const file = (await service.createBackup(path.join(home, "empty"))).file!;
    const { closeDb } = await import("./db");
    closeDb();
    fs.rmSync(dataDir(), { recursive: true });
    fs.mkdirSync(path.join(dataDir(), "documents"), { recursive: true });
    fs.writeFileSync(path.join(dataDir(), "documents", "abcdef012345-orphan.pdf"), "%PDF-1.7");

    const result = await service.restoreBackup(file);

    expect(result.safetyBackup).toBeDefined();
  });
});
