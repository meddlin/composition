import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, listNotes, loadWebSettings, resolvedDbPath, service } from "./backend";
import { keepSearchOffline } from "./offlineSearch";

// Never the real ~/.composition: every test points the shared data layer at a temp home.
let home: string;
const saved = process.env.COMPOSITION_SETTINGS_PATH;

beforeEach(() => {
  keepSearchOffline(); // never reach a real Meilisearch
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-cli-"));
  const settings = path.join(home, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ appDataDir: path.join(home, "data"), theme: "dark" }));
  process.env.COMPOSITION_SETTINGS_PATH = settings;
});

afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  if (saved === undefined) delete process.env.COMPOSITION_SETTINGS_PATH;
  else process.env.COMPOSITION_SETTINGS_PATH = saved;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("backend seam", () => {
  it("reads settings from COMPOSITION_SETTINGS_PATH and keeps the database in its data dir", () => {
    const settings = loadWebSettings();
    expect(settings.appDataDir).toBe(path.join(home, "data"));
    expect(resolvedDbPath(settings)).toBe(path.join(home, "data", "composition.db"));
  });

  it("creates and lists a note through the shared service layer", async () => {
    const note = await service.createNote("First note");
    expect(note.title).toBe("First note");
    expect(listNotes().map((n) => n.title)).toEqual(["First note"]);
    expect((await service.loadWorkspace()).notes).toHaveLength(1);
  });
});
