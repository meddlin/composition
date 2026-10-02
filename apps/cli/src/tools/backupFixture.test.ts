import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, service } from "../backend";
import { keepSearchOffline } from "../offlineSearch";
import { APPS, dataDirFor, inspectBackup, loadFixture, samplePng, setupFixture, settingsFileFor, verifyFixture, wipeFixture } from "./backupFixture";

/**
 * The manual backup tests are only as good as their fixture and their verdict, so both are tested
 * here: setup must produce the data it promises, verify must notice when any of it is missing or
 * changed, and a backup/restore round trip must satisfy it for each app's layout.
 */

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "composition-fixture-"));
  vi.stubEnv("HOME", root); // the safety backup of a restore goes to ~/Composition Backups
  keepSearchOffline();
});
afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const failing = (home: string) => verifyFixture(home).filter((c) => !c.ok).map((c) => c.name);

describe("samplePng", () => {
  it("is a PNG that the app accepts as an image", async () => {
    const png = samplePng();
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(160); // width, in the IHDR chunk
  });
});

describe.each(APPS)("the %s fixture", (app) => {
  it("puts each app's settings where that app reads them, and everything else in ~/.composition", async () => {
    const home = path.join(root, app);

    const fixture = await setupFixture(app, home);

    expect(fs.existsSync(settingsFileFor(app, home))).toBe(true);
    expect(JSON.parse(fs.readFileSync(settingsFileFor(app, home), "utf-8")).appDataDir).toBe(dataDirFor(home));
    expect(fixture.notes.map((n) => n.title).sort()).toEqual(["Alpha plan", "Picture note", "Report note", "Welcome"]);
    expect(fixture.trashedNotes.map((n) => n.title)).toEqual(["Deleted note"]);
    expect(fixture.groups.map((g) => g.name).sort()).toEqual(["Alpha", "Projects"]);
    expect(fixture.images).toHaveLength(1);
    expect(fixture.attachments.map((a) => a.fileName)).toEqual(["Quarterly report.txt"]);
    expect(fixture.settings).toMatchObject({ theme: "forest", city: "Austin, Texas, United States", sidebarWidth: 300 });
    expect(failing(home)).toEqual([]);
  });

  it("refuses to be set up over existing data", async () => {
    const home = path.join(root, app);
    await setupFixture(app, home);
    closeDb();
    await expect(setupFixture(app, home)).rejects.toThrow(/already has Composition data/);
  });

  it("makes a backup that has everything, which survives losing everything", async () => {
    const home = path.join(root, app);
    await setupFixture(app, home);
    const made = await service.createBackup(path.join(home, "backups"));
    expect(made.error).toBeUndefined();
    expect((await inspectBackup(made.file!, home)).checks.filter((c) => !c.ok)).toEqual([]);

    closeDb();
    wipeFixture(home);
    expect(failing(home).length).toBeGreaterThan(0);
    const restored = await service.restoreBackup(made.file!);

    expect(restored.error).toBeUndefined();
    closeDb();
    expect(failing(home)).toEqual([]);
  });
});

describe("verifyFixture notices", () => {
  async function fresh() {
    const home = path.join(root, "cli");
    await setupFixture("cli", home);
    closeDb();
    return home;
  }

  it("a note that was edited", async () => {
    const home = await fresh();
    const db = new Database(path.join(dataDirFor(home), "composition.db"));
    db.prepare("UPDATE notes SET content = content || 'x' WHERE title = 'Welcome'").run();
    db.close();
    expect(failing(home)).toEqual(["every note's text is byte-for-byte the same"]);
  });

  it("a missing image, a missing attachment, and a changed setting", async () => {
    const home = await fresh();
    const dir = dataDirFor(home);
    fs.rmSync(path.join(dir, "app_data"), { recursive: true });
    fs.rmSync(path.join(dir, "attachments"), { recursive: true });
    const settings = JSON.parse(fs.readFileSync(settingsFileFor("cli", home), "utf-8"));
    fs.writeFileSync(settingsFileFor("cli", home), JSON.stringify({ ...settings, theme: "light" }));

    const names = failing(home);
    expect(names.some((n) => n.startsWith("images"))).toBe(true);
    expect(names.some((n) => n.startsWith("attachments"))).toBe(true);
    expect(names.some((n) => n.startsWith("settings"))).toBe(true);
  });

  it("a data location that moved, and a scratch folder left behind", async () => {
    const home = await fresh();
    fs.mkdirSync(path.join(dataDirFor(home), ".restore-abc"));
    const settings = JSON.parse(fs.readFileSync(settingsFileFor("cli", home), "utf-8"));
    fs.writeFileSync(settingsFileFor("cli", home), JSON.stringify({ ...settings, appDataDir: "/elsewhere" }));

    const names = failing(home);
    expect(names).toContain("the data location was left alone");
    expect(names).toContain("no scratch folders were left behind");
  });
});

describe("wipeFixture", () => {
  it("refuses while the database looks open, unless forced", async () => {
    const home = path.join(root, "cli");
    await setupFixture("cli", home); // the connection is still open, so there is a -wal file
    expect(fs.existsSync(path.join(dataDirFor(home), "composition.db-wal"))).toBe(true);

    expect(() => wipeFixture(home)).toThrow(/Quit the app first/);

    closeDb();
    expect(() => wipeFixture(home)).not.toThrow();
    expect(loadFixture(home).notes.length).toBeGreaterThan(0); // the record of what was there stays
  });
});
