import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSettings } from "./backend";
import { ApplicationDataMoveError, moveApplicationData } from "./dataLocation";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "composition-move-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function settingsFor(appDataDir: string, extra: Partial<WebSettings> = {}): WebSettings {
  return {
    appDataDir,
    theme: "forest",
    sidebarWidth: 256,
    editorRatio: 0.5,
    favorites: [],
    ...extra,
  };
}

/** Every kind of file the app keeps in its data directory. */
function writeAllApplicationData(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "composition.db"), "database");
  fs.writeFileSync(path.join(dir, "composition.db-wal"), "wal");
  fs.writeFileSync(path.join(dir, "composition.db-shm"), "shm");
  fs.writeFileSync(path.join(dir, "composition.db-journal"), "journal");
  fs.mkdirSync(path.join(dir, "meili_data"));
  fs.writeFileSync(path.join(dir, "meili_data", "data.ms"), "search data");
  fs.writeFileSync(path.join(dir, "meili.log"), "log");
  fs.writeFileSync(path.join(dir, "meili_master_key"), "secret");
  fs.mkdirSync(path.join(dir, "attachments"));
  fs.writeFileSync(path.join(dir, "attachments", "a.pdf"), "attachment");
  fs.mkdirSync(path.join(dir, "images"));
  fs.writeFileSync(path.join(dir, "images", "pic.png"), "image");
}

const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf-8");

describe("moveApplicationData", () => {
  it("moves every managed file, images and attachments included", () => {
    const oldDir = path.join(root, "old");
    const newDir = path.join(root, "new");
    writeAllApplicationData(oldDir);
    const saved: WebSettings[] = [];

    const moved = moveApplicationData(settingsFor(oldDir), newDir, {
      saveSettings: (s) => saved.push(s),
    });

    expect(moved.appDataDir).toBe(newDir);
    expect(moved.theme).toBe("forest");
    expect(saved).toEqual([moved]);
    expect(read(newDir, "composition.db")).toBe("database");
    expect(read(newDir, "composition.db-wal")).toBe("wal");
    expect(read(newDir, "composition.db-shm")).toBe("shm");
    expect(read(newDir, "composition.db-journal")).toBe("journal");
    expect(read(newDir, "meili_data", "data.ms")).toBe("search data");
    expect(read(newDir, "meili.log")).toBe("log");
    expect(read(newDir, "meili_master_key")).toBe("secret");
    expect(read(newDir, "attachments", "a.pdf")).toBe("attachment");
    expect(read(newDir, "images", "pic.png")).toBe("image");
    expect(fs.existsSync(oldDir)).toBe(false);
  });

  it("can move back to the original location", () => {
    const first = path.join(root, "default");
    const second = path.join(root, "custom");
    writeAllApplicationData(first);
    const noSave = { saveSettings: () => {} };

    const away = moveApplicationData(settingsFor(first), second, noSave);
    const back = moveApplicationData(away, first, noSave);

    expect(back.appDataDir).toBe(first);
    expect(read(first, "composition.db")).toBe("database");
    expect(fs.existsSync(second)).toBe(false);
  });

  it("does nothing when the destination is the current location", () => {
    const dir = path.join(root, "data");
    writeAllApplicationData(dir);
    const settings = settingsFor(dir);
    let saves = 0;

    const result = moveApplicationData(settings, dir, { saveSettings: () => saves++ });

    expect(result).toBe(settings);
    expect(saves).toBe(0);
    expect(read(dir, "composition.db")).toBe("database");
  });

  it("expands ~ in the destination", () => {
    const dir = path.join(root, "data");
    writeAllApplicationData(dir);

    const moved = moveApplicationData(settingsFor(dir), "~/composition-move-test", {
      saveSettings: () => {},
    });

    try {
      expect(moved.appDataDir).toBe(path.join(os.homedir(), "composition-move-test"));
      expect(read(moved.appDataDir, "composition.db")).toBe("database");
    } finally {
      fs.rmSync(moved.appDataDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite data already at the destination", () => {
    const oldDir = path.join(root, "old");
    const newDir = path.join(root, "new");
    writeAllApplicationData(oldDir);
    fs.mkdirSync(newDir);
    fs.writeFileSync(path.join(newDir, "composition.db"), "existing");

    expect(() => moveApplicationData(settingsFor(oldDir), newDir, { saveSettings: () => {} })).toThrow(
      /already contains/,
    );

    expect(read(oldDir, "composition.db")).toBe("database");
    expect(read(newDir, "composition.db")).toBe("existing");
  });

  it("refuses a destination inside the current data", () => {
    const oldDir = path.join(root, "old");
    writeAllApplicationData(oldDir);

    expect(() =>
      moveApplicationData(settingsFor(oldDir), path.join(oldDir, "nested"), { saveSettings: () => {} }),
    ).toThrow(/cannot be inside/);
    expect(fs.existsSync(path.join(oldDir, "nested"))).toBe(false);
  });

  it("refuses a destination that is a file", () => {
    const oldDir = path.join(root, "old");
    writeAllApplicationData(oldDir);
    const file = path.join(root, "a-file");
    fs.writeFileSync(file, "x");

    expect(() => moveApplicationData(settingsFor(oldDir), file, { saveSettings: () => {} })).toThrow(
      /not a directory/,
    );
  });

  it("rolls everything back when saving the settings fails", () => {
    const oldDir = path.join(root, "old");
    const newDir = path.join(root, "new");
    writeAllApplicationData(oldDir);

    let caught: unknown;
    try {
      moveApplicationData(settingsFor(oldDir), newDir, {
        saveSettings: () => {
          throw new Error("settings failed");
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApplicationDataMoveError);
    expect((caught as Error).message).toMatch(/settings failed/);
    expect(read(oldDir, "composition.db")).toBe("database");
    expect(read(oldDir, "composition.db-wal")).toBe("wal");
    expect(read(oldDir, "meili_data", "data.ms")).toBe("search data");
    expect(read(oldDir, "attachments", "a.pdf")).toBe("attachment");
    expect(read(oldDir, "images", "pic.png")).toBe("image");
    expect(fs.existsSync(newDir)).toBe(false);
  });

  it("moves only what exists", () => {
    const oldDir = path.join(root, "old");
    const newDir = path.join(root, "new");
    fs.mkdirSync(oldDir);
    fs.writeFileSync(path.join(oldDir, "composition.db"), "database");

    const moved = moveApplicationData(settingsFor(oldDir), newDir, { saveSettings: () => {} });

    expect(fs.readdirSync(newDir)).toEqual(["composition.db"]);
    expect(moved.appDataDir).toBe(newDir);
  });

  it("follows a database path override and clears it, since the database now sits in the data dir", () => {
    const oldDir = path.join(root, "old");
    const newDir = path.join(root, "new");
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(oldDir);
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "notes.db"), "notes");
    fs.writeFileSync(path.join(elsewhere, "notes.db-wal"), "wal");

    const moved = moveApplicationData(
      settingsFor(oldDir, { dbPath: path.join(elsewhere, "notes.db") }),
      newDir,
      { saveSettings: () => {} },
    );

    expect(moved.dbPath).toBeUndefined();
    expect(read(newDir, "composition.db")).toBe("notes");
    expect(read(newDir, "composition.db-wal")).toBe("wal");
    expect(fs.existsSync(path.join(elsewhere, "notes.db"))).toBe(false);
  });
});
