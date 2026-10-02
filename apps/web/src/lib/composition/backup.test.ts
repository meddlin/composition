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
    location: { name: "Austin, Texas", latitude: 30.27, longitude: -97.74, timezone: "America/Chicago" },
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
    expect(result.counts).toEqual({ notes: 2, groups: 1, trashedNotes: 1, trashedGroups: 0, images: 1, attachments: 1 });
    // Only the backup is left in the folder, none of the working files.
    expect(fs.readdirSync(backups)).toEqual([path.basename(result.file!)]);
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

    expect(settings).toMatchObject({ theme: "forest", sidebarWidth: 333, location: { name: "Austin, Texas" } });
    expect(settings).not.toHaveProperty("appDataDir");
    expect(settings).not.toHaveProperty("dbPath");
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

    expect(result.counts).toEqual({ notes: 0, groups: 0, trashedNotes: 0, trashedGroups: 0, images: 0, attachments: 0 });
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
    expect(result.counts).toEqual({ notes: 2, groups: 1, trashedNotes: 1, trashedGroups: 0, images: 1, attachments: 1 });
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
      location: { name: "Austin, Texas" },
    });
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
    expect((await service.loadWorkspace()).notes.map((n) => n.title)).toEqual(["Ancient"]);
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
    for (const name of ["/tmp/escaped.png", "meili.log", "app_data/script.html", "app_data/sub/pic.png", "attachments/.hidden"]) {
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
        { dir, createdAt: "x", counts: {} as never, settings: null, hasImages: true, hasAttachments: false },
        { appDataDir: dataDir(), dbPath: path.join(dataDir(), "composition.db") },
      ),
    ).toThrow(/previous data was put back/);

    expect(fs.readdirSync(images)).toEqual(["mine-aaaaaaaaaaaa.png"]);
    expect((await service.loadWorkspace()).notes.map((n) => n.title)).toEqual(["Keep me"]);
  });
});
