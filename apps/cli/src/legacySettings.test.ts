import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLegacySettings } from "./legacySettings";

let root: string;
let target: string;
let legacy: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "composition-legacy-"));
  target = path.join(root, "cli", "settings.json");
  legacy = path.join(root, "old", "settings.yaml");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const writeLegacy = (yaml: string) => fs.writeFileSync(legacy, yaml);
const imported = () => JSON.parse(fs.readFileSync(target, "utf-8"));

describe("importLegacySettings", () => {
  it("imports the data directory and maps the old theme names", () => {
    writeLegacy(`app_data_dir: ${root}/data\ntheme: composition-forest\n`);

    expect(importLegacySettings({ target, legacy })).toBe(true);

    expect(imported()).toEqual({ appDataDir: path.join(root, "data"), theme: "forest" });
  });

  it.each([
    ["textual-dark", "dark"],
    ["composition-light", "light"],
    ["composition-forest", "forest"],
    ["cream", "cream"],
    ["not-a-real-theme", "dark"],
  ])("maps theme %s to %s", (before, after) => {
    writeLegacy(`app_data_dir: ${root}/data\ntheme: ${before}\n`);
    importLegacySettings({ target, legacy });
    expect(imported().theme).toBe(after);
  });

  it("defaults the theme to dark when there is none", () => {
    writeLegacy(`app_data_dir: ${root}/data\n`);
    importLegacySettings({ target, legacy });
    expect(imported().theme).toBe("dark");
  });

  it("expands ~ in the data directory", () => {
    writeLegacy("app_data_dir: ~/notes-data\n");
    importLegacySettings({ target, legacy });
    expect(imported().appDataDir).toBe(path.join(os.homedir(), "notes-data"));
  });

  it("reads through a symlink, as the old data-location move left behind", () => {
    const real = path.join(root, "moved", "settings.yaml");
    fs.mkdirSync(path.dirname(real));
    fs.writeFileSync(real, `app_data_dir: ${root}/moved\ntheme: composition-light\n`);
    fs.symlinkSync(real, legacy);

    expect(importLegacySettings({ target, legacy })).toBe(true);

    expect(imported()).toEqual({ appDataDir: path.join(root, "moved"), theme: "light" });
  });

  it("turns the pre-consolidation db_path format into a data directory", () => {
    writeLegacy(`db_path: ${root}/custom/composition.db\ntheme: composition-light\n`);
    importLegacySettings({ target, legacy });
    expect(imported()).toEqual({ appDataDir: path.join(root, "custom"), theme: "light" });
  });

  it("keeps a db_path with another file name as a database override", () => {
    writeLegacy(`db_path: ${root}/custom/notes.db\n`);
    importLegacySettings({ target, legacy });
    expect(imported()).toEqual({
      appDataDir: path.join(root, "custom"),
      dbPath: path.join(root, "custom", "notes.db"),
      theme: "dark",
    });
  });

  it("never overwrites settings that already exist", () => {
    writeLegacy(`app_data_dir: ${root}/data\n`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{"theme":"cream"}');

    expect(importLegacySettings({ target, legacy })).toBe(false);

    expect(fs.readFileSync(target, "utf-8")).toBe('{"theme":"cream"}');
  });

  it("does nothing when there is no old settings file", () => {
    expect(importLegacySettings({ target, legacy })).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });

  it.each([["not: [valid"], ["- just\n- a list\n"], [""], ["plain text"]])(
    "ignores an unusable old settings file (%j)",
    (content) => {
      writeLegacy(content);
      expect(importLegacySettings({ target, legacy })).toBe(false);
      expect(fs.existsSync(target)).toBe(false);
    },
  );

  it("writes nothing useful to import when the old file sets neither location", () => {
    writeLegacy("theme: composition-light\n");
    expect(importLegacySettings({ target, legacy })).toBe(true);
    expect(imported()).toEqual({ theme: "light" });
  });
});
