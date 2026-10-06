import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT } from "./layout";

// Meilisearch isn't running in tests; indexing is best-effort in the service,
// so a stub keeps the suite quiet and fast without changing what's under test.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "Search is unavailable. Is Meilisearch running at http://127.0.0.1:7700?",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-service-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("saveSettings", () => {
  it("keeps the theme and column layout when the data location is saved", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({
      ...loadWebSettings(),
      theme: "forest",
      sidebarWidth: 320,
      editorRatio: 0.3,
    });
    const { saveSettings } = await import("./service");

    const result = await saveSettings({ appDataDir: path.join(home, "notes"), dbPath: "" });

    expect(result.success).toBe(true);
    expect(loadWebSettings()).toEqual({
      appDataDir: path.join(home, "notes"),
      theme: "forest",
      sidebarWidth: 320,
      editorRatio: 0.3,
      favorites: [],
    });
  });

  it("keeps the favorites when the data location is saved", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), favorites: [{ type: "group", id: 3 }] });
    const { saveSettings } = await import("./service");

    await saveSettings({ appDataDir: path.join(home, "notes"), dbPath: "" });

    expect(loadWebSettings().favorites).toEqual([{ type: "group", id: 3 }]);
  });

  it("drops a previously stored dbPath when the field is cleared", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), dbPath: path.join(home, "old.db") });
    const { saveSettings } = await import("./service");

    await saveSettings({ appDataDir: path.join(home, "notes"), dbPath: "" });

    expect(loadWebSettings().dbPath).toBeUndefined();
  });

  it("requires an application data directory", async () => {
    const { saveSettings } = await import("./service");

    const result = await saveSettings({ appDataDir: "   ", dbPath: "" });

    expect(result).toEqual({ error: "Application data directory is required." });
  });
});

describe("saveFavorites", () => {
  it("stores the pinned list, leaves other settings alone and hands it back with the workspace", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), theme: "forest" });
    const { saveFavorites, loadWorkspace } = await import("./service");

    await saveFavorites([
      { type: "note", id: 2 },
      { type: "group", id: 1 },
    ]);

    expect(loadWebSettings().theme).toBe("forest");
    expect((await loadWorkspace()).favorites).toEqual([
      { type: "note", id: 2 },
      { type: "group", id: 1 },
    ]);
  });

  it("discards malformed entries rather than trusting the caller", async () => {
    const { saveFavorites, loadWorkspace } = await import("./service");

    await saveFavorites([{ type: "note", id: 2 }, { type: "bogus", id: 1 }] as never);

    expect((await loadWorkspace()).favorites).toEqual([{ type: "note", id: 2 }]);
  });
});

describe("saveTheme", () => {
  it("stores a known scheme and leaves the rest of the settings alone", async () => {
    const { loadWebSettings } = await import("./webSettings");
    const { saveTheme } = await import("./service");

    expect(await saveTheme("light")).toEqual({});

    expect(loadWebSettings()).toMatchObject({ theme: "light", ...DEFAULT_LAYOUT });
  });

  it("rejects an unknown scheme without writing it", async () => {
    const { loadWebSettings } = await import("./webSettings");
    const { saveTheme } = await import("./service");

    expect(await saveTheme("neon")).toEqual({ error: "Unknown color scheme." });

    expect(loadWebSettings().theme).toBe("dark");
  });
});

describe("loadSettings", () => {
  it("reports the default location and that no database exists yet", async () => {
    const { loadSettings } = await import("./service");

    const snapshot = await loadSettings();

    expect(snapshot).toEqual({
      theme: "dark",
      appDataDir: path.join(home, ".composition"),
      dbPath: path.join(home, ".composition", "composition.db"),
      dbPathOverride: "",
      derivedDbPath: path.join(home, ".composition", "composition.db"),
      dirWritable: false,
      dbExists: false,
      backupDir: path.join(home, "Composition Backups"),
      trash: { notes: [], groups: [] },
      city: "",
    });
  });

  it("reports an explicit database override separately from the derived path", async () => {
    const { saveSettings, loadSettings } = await import("./service");
    const dbPath = path.join(home, "elsewhere", "mine.db");
    await saveSettings({ appDataDir: path.join(home, "data"), dbPath });

    const snapshot = await loadSettings();

    expect(snapshot).toMatchObject({
      appDataDir: path.join(home, "data"),
      dbPath,
      dbPathOverride: dbPath,
      derivedDbPath: path.join(home, "data", "composition.db"),
      dirWritable: true,
      dbExists: false,
    });
  });
});

describe("notes", () => {
  it("creates a note, reconciles edited frontmatter into its columns, and lists it", async () => {
    const service = await import("./service");
    const created = await service.createNote("Draft");

    const saved = await service.saveNoteContent(
      created.id,
      created.content.replace("title: Draft", "title: Final"),
    );

    expect(saved.title).toBe("Final");
    const { notes } = await service.loadWorkspace();
    expect(notes.map((n) => n.title)).toEqual(["Final"]);
  });

  it("falls back to a raw content save when the frontmatter is mid-edit and invalid", async () => {
    const service = await import("./service");
    const created = await service.createNote("Keep me");

    const saved = await service.saveNoteContent(created.id, "---\ntitle: [unclosed\n---\nbody");

    expect(saved.content).toBe("---\ntitle: [unclosed\n---\nbody");
    expect(saved.title).toBe("Keep me");
  });

  it("throws for a note that doesn't exist", async () => {
    const service = await import("./service");

    await expect(service.saveNoteContent(999, "---\ntitle: x\n---\n")).rejects.toThrow(
      "Note 999 not found",
    );
  });
});

describe("groups", () => {
  it("refuses to delete a group that still has a note, with a message for the UI", async () => {
    const service = await import("./service");
    const group = await service.createGroup("Work", null);
    await service.createNote("In work", group.id);

    const result = await service.deleteGroup(group.id);

    expect(result.error).toMatch(/still has sub-groups or notes/);
    expect((await service.loadWorkspace()).groups).toHaveLength(1);
  });

  it("renames a group and returns it", async () => {
    const service = await import("./service");
    const group = await service.createGroup("Old name", null);

    const renamed = await service.renameGroup(group.id, "New name");

    expect(renamed.name).toBe("New name");
    expect((await service.loadWorkspace()).groups.map((g) => g.name)).toEqual(["New name"]);
  });

  it("refuses to rename a group that doesn't exist", async () => {
    const service = await import("./service");

    await expect(service.renameGroup(999, "Anything")).rejects.toThrow("Group 999 not found");
  });

  it("deletes an empty group", async () => {
    const service = await import("./service");
    const group = await service.createGroup("Empty", null);

    expect(await service.deleteGroup(group.id)).toEqual({});

    expect((await service.loadWorkspace()).groups).toEqual([]);
  });

  it("reparents a group, returns it to the top level, and refuses to create a loop", async () => {
    const service = await import("./service");
    const a = await service.createGroup("A", null);
    const b = await service.createGroup("B", null);
    const c = await service.createGroup("C", b.id);

    const nested = await service.moveGroup(b.id, a.id);
    expect(nested.group).toMatchObject({ id: b.id, parentId: a.id });

    const back = await service.moveGroup(b.id, null);
    expect(back.group).toMatchObject({ id: b.id, parentId: null });

    // Into itself, and into its own descendant: refused with a message, nothing changed.
    expect(await service.moveGroup(b.id, b.id)).toEqual({ error: expect.any(String) });
    expect(await service.moveGroup(b.id, c.id)).toEqual({ error: expect.any(String) });
    const { groups } = await service.loadWorkspace();
    expect(groups.find((g) => g.id === b.id)?.parentId).toBeNull();
  });

  it("reports a missing group on a move instead of throwing", async () => {
    const service = await import("./service");
    const a = await service.createGroup("A", null);

    expect(await service.moveGroup(a.id, 999)).toEqual({ error: expect.any(String) });
    expect(await service.moveGroup(999, null)).toEqual({ error: expect.any(String) });
  });

  it("moves a note between groups without re-ordering it", async () => {
    const service = await import("./service");
    const group = await service.createGroup("Ideas", null);
    const note = await service.createNote("Loose");

    const moved = await service.moveNoteToGroup(note.id, group.id);

    expect(moved.groupId).toBe(group.id);
    expect(moved.updatedAt).toBe(note.updatedAt);
  });
});

describe("Trash Can", () => {
  it("moves a deleted note out of the workspace and the search index, but keeps it restorable", async () => {
    const searchIndex = await import("./searchIndex");
    const service = await import("./service");
    const note = await service.createNote("Precious");

    await service.deleteNote(note.id);

    expect((await service.loadWorkspace()).notes).toEqual([]);
    expect(searchIndex.deleteNoteFromIndex).toHaveBeenCalledWith(note.id);
    const trash = await service.loadTrash();
    expect(trash.notes).toEqual([
      { id: note.id, title: "Precious", deletedAt: expect.any(String), expiresAt: expect.any(String) },
    ]);
  });

  it("schedules permanent deletion 60 days after the deletion", async () => {
    const service = await import("./service");
    const note = await service.createNote("Precious");
    await service.deleteNote(note.id);

    const [trashed] = (await service.loadTrash()).notes;

    const days = (Date.parse(trashed.expiresAt) - Date.parse(trashed.deletedAt)) / 86_400_000;
    expect(days).toBe(60);
  });

  it("restores a note whole, into its group, and back into the search index", async () => {
    const searchIndex = await import("./searchIndex");
    const service = await import("./service");
    const group = await service.createGroup("Work", null);
    const note = await service.createNote("Precious", group.id);
    const edited = await service.saveNoteContent(
      note.id,
      note.content.replace("title: Precious", "title: Precious\ntags:\n- a"),
    );
    await service.deleteNote(note.id);
    vi.mocked(searchIndex.indexNote).mockClear();

    expect(await service.restoreNote(note.id)).toEqual({ restoredToTopLevel: false });

    const { notes } = await service.loadWorkspace();
    expect(notes).toEqual([edited]);
    expect(searchIndex.indexNote).toHaveBeenCalledWith(edited);
    expect((await service.loadTrash()).notes).toEqual([]);
  });

  it("restores a note ungrouped when its group has been deleted since", async () => {
    const service = await import("./service");
    const group = await service.createGroup("Work", null);
    const note = await service.createNote("Precious", group.id);
    await service.deleteNote(note.id);
    await service.deleteGroup(group.id);

    expect(await service.restoreNote(note.id)).toEqual({ restoredToTopLevel: true });

    expect((await service.loadWorkspace()).notes[0]).toMatchObject({ id: note.id, groupId: null });
  });

  it("restores a note into its group once that group has been restored too", async () => {
    const service = await import("./service");
    const group = await service.createGroup("Work", null);
    const note = await service.createNote("Precious", group.id);
    await service.deleteNote(note.id);
    await service.deleteGroup(group.id);

    await service.restoreGroup(group.id);
    await service.restoreNote(note.id);

    expect((await service.loadWorkspace()).notes[0]).toMatchObject({ id: note.id, groupId: group.id });
  });

  it("moves a deleted group to the trash and restores it under its parent", async () => {
    const service = await import("./service");
    const parent = await service.createGroup("Parent", null);
    const child = await service.createGroup("Child", parent.id);

    expect(await service.deleteGroup(child.id)).toEqual({});
    expect((await service.loadWorkspace()).groups.map((g) => g.id)).toEqual([parent.id]);
    expect((await service.loadTrash()).groups.map((g) => g.name)).toEqual(["Child"]);

    expect(await service.restoreGroup(child.id)).toEqual({ restoredToTopLevel: false });
    expect((await service.loadWorkspace()).groups).toContainEqual(child);
  });

  it("restores a group at the top level when its parent is gone", async () => {
    const service = await import("./service");
    const parent = await service.createGroup("Parent", null);
    const child = await service.createGroup("Child", parent.id);
    await service.deleteGroup(child.id);
    await service.deleteGroup(parent.id);

    expect(await service.restoreGroup(child.id)).toEqual({ restoredToTopLevel: true });

    expect((await service.loadWorkspace()).groups).toEqual([{ ...child, parentId: null }]);
  });

  it("does not trash a group that still has a note", async () => {
    const service = await import("./service");
    const group = await service.createGroup("Work", null);
    await service.createNote("In work", group.id);

    await service.deleteGroup(group.id);

    expect((await service.loadTrash()).groups).toEqual([]);
  });

  it("lists the most recently deleted first", async () => {
    const service = await import("./service");
    const a = await service.createNote("A");
    const b = await service.createNote("B");
    await service.deleteNote(a.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.deleteNote(b.id);

    expect((await service.loadTrash()).notes.map((n) => n.title)).toEqual(["B", "A"]);
  });

  it("permanently deletes an item on request, and says so when it is already gone", async () => {
    const service = await import("./service");
    const note = await service.createNote("Doomed");
    const group = await service.createGroup("Doomed", null);
    await service.deleteNote(note.id);
    await service.deleteGroup(group.id);

    await service.permanentlyDeleteNote(note.id);
    await service.permanentlyDeleteGroup(group.id);

    expect(await service.loadTrash()).toEqual({ notes: [], groups: [] });
    expect(await service.restoreNote(note.id)).toEqual({ error: expect.any(String) });
    expect(await service.restoreGroup(group.id)).toEqual({ error: expect.any(String) });
  });

  it("permanently deletes items older than 60 days when the trash is loaded, and keeps newer ones", async () => {
    const { getDb } = await import("./db");
    const service = await import("./service");
    const old = await service.createNote("Old");
    const recent = await service.createNote("Recent");
    const oldGroup = await service.createGroup("Old group", null);
    await service.deleteNote(old.id);
    await service.deleteNote(recent.id);
    await service.deleteGroup(oldGroup.id);
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const db = getDb();
    db.prepare("UPDATE trashed_notes SET deleted_at = ? WHERE id = ?").run(daysAgo(61), old.id);
    db.prepare("UPDATE trashed_notes SET deleted_at = ? WHERE id = ?").run(daysAgo(59), recent.id);
    db.prepare("UPDATE trashed_groups SET deleted_at = ? WHERE id = ?").run(daysAgo(61), oldGroup.id);

    const trash = await service.loadTrash();

    expect(trash.notes.map((n) => n.title)).toEqual(["Recent"]);
    expect(trash.groups).toEqual([]);
  });

  it("clears expired items when the workspace opens", async () => {
    const { getDb } = await import("./db");
    const service = await import("./service");
    const note = await service.createNote("Old");
    await service.deleteNote(note.id);
    getDb()
      .prepare("UPDATE trashed_notes SET deleted_at = ?")
      .run(new Date(Date.now() - 61 * 86_400_000).toISOString());

    await service.loadWorkspace();

    expect(getDb().prepare("SELECT COUNT(*) AS n FROM trashed_notes").get()).toEqual({ n: 0 });
  });

  it("shows the trash in the settings snapshot without creating a missing database", async () => {
    const fsModule = await import("node:fs");
    const service = await import("./service");

    const empty = await service.loadSettings();
    expect(empty.trash).toEqual({ notes: [], groups: [] });
    expect(fsModule.existsSync(empty.dbPath)).toBe(false);

    const note = await service.createNote("Keep");
    await service.deleteNote(note.id);
    expect((await service.loadSettings()).trash.notes.map((n) => n.title)).toEqual(["Keep"]);
  });

  it("leaves the CLI's two tables free of anything in the trash", async () => {
    const { getDb } = await import("./db");
    const service = await import("./service");
    const note = await service.createNote("Gone");
    await service.deleteNote(note.id);

    expect(getDb().prepare("SELECT COUNT(*) AS n FROM notes").get()).toEqual({ n: 0 });
  });
});

describe("searchNotes", () => {
  it("reports an unavailable search backend instead of throwing", async () => {
    const searchIndex = await import("./searchIndex");
    vi.mocked(searchIndex.searchNoteIds).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { searchNotes } = await import("./service");

    const result = await searchNotes("anything");

    expect(result.hits).toEqual([]);
    expect(result.error).toMatch(/Search is unavailable/);
  });
});

describe("saveLocation", () => {
  const austin = {
    name: "Austin, Texas, United States",
    latitude: 30.26715,
    longitude: -97.74306,
    timezone: "America/Chicago",
  };

  // Answers the geocoding request with `results`, and the forecast request with no days.
  function stubOpenMeteo(results: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        const body = String(url).includes("geocoding") ? { results } : { daily: {} };
        return new Response(JSON.stringify(body));
      }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves the matched city alongside the other settings", async () => {
    stubOpenMeteo([
      {
        name: "Austin",
        admin1: "Texas",
        country: "United States",
        latitude: austin.latitude,
        longitude: austin.longitude,
        timezone: austin.timezone,
      },
    ]);
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), theme: "auto" });
    const { saveLocation } = await import("./service");

    const result = await saveLocation(" Austin, TX ");

    expect(result).toMatchObject({ saved: { name: austin.name } });
    expect(loadWebSettings()).toMatchObject({ theme: "auto", location: austin });
  });

  it("reports an unknown city without touching the saved one", async () => {
    stubOpenMeteo([]);
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), location: austin });
    const { saveLocation } = await import("./service");

    const result = await saveLocation("Nowhereville");

    expect(result.error).toContain("Nowhereville");
    expect(result.saved).toBeUndefined();
    expect(loadWebSettings().location).toEqual(austin);
  });

  it("reports an unreachable lookup service", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const { saveLocation } = await import("./service");

    expect((await saveLocation("Austin")).error).toMatch(/connection/);
  });

  it("forgets the saved city when the field is emptied", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), theme: "auto", location: austin });
    const { saveLocation } = await import("./service");

    expect(await saveLocation("  ")).toEqual({});

    const settings = loadWebSettings();
    expect(settings.location).toBeUndefined();
    expect(settings.theme).toBe("auto");
  });

  it("shows the saved city in the settings snapshot", async () => {
    stubOpenMeteo([]);
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), location: austin });
    const { loadSettings } = await import("./service");

    expect(await loadSettings()).toMatchObject({ city: austin.name, sunTimes: {} });
  });
});

describe("loadSunSchedule", () => {
  it("is null unless the auto scheme is selected", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), theme: "forest" });
    const { loadSunSchedule, initialSunTheme } = await import("./service");

    expect(await loadSunSchedule()).toBeNull();
    expect(initialSunTheme()).toBeUndefined();
  });

  it("uses stand-in times for the auto scheme when no city is saved", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), theme: "auto" });
    const { loadSunSchedule, initialSunTheme } = await import("./service");

    expect(await loadSunSchedule()).toMatchObject({ estimated: true, retry: false });
    expect(initialSunTheme()).toMatchObject({ tone: expect.stringMatching(/^(light|dark)$/) });
  });
});

describe("saveImage", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("files the image under the note's title in <app data>/app_data and reads it back", async () => {
    const { loadWebSettings } = await import("./webSettings");
    const { createNote, saveImage, readImage } = await import("./service");
    const note = await createNote("Trip Plan");

    const result = await saveImage({ noteId: note.id, fileName: "map.png", data: PNG });

    expect(result.name).toMatch(/^trip-plan-map-[0-9a-f]{12}\.png$/);
    expect(fs.existsSync(path.join(loadWebSettings().appDataDir, "app_data", result.name!))).toBe(true);
    expect((await readImage(result.name!))?.contentType).toBe("image/png");
  });

  it("follows the application data directory when it is changed in Settings", async () => {
    const { saveSettings, createNote, saveImage } = await import("./service");
    const note = await createNote("Trip");
    await saveSettings({ appDataDir: path.join(home, "elsewhere"), dbPath: path.join(home, "kept.db") });
    const moved = await createNote("Trip");

    const result = await saveImage({ noteId: moved.id, fileName: "map.png", data: PNG });

    expect(note.id).toBeDefined();
    expect(fs.readdirSync(path.join(home, "elsewhere", "app_data"))).toEqual([result.name]);
  });

  it("refuses a note that does not exist", async () => {
    const { saveImage } = await import("./service");

    expect(await saveImage({ noteId: 999, fileName: "map.png", data: PNG })).toEqual({
      error: "That note no longer exists.",
    });
  });

  it("returns the reason instead of throwing for something that isn't an image", async () => {
    const { createNote, saveImage } = await import("./service");
    const note = await createNote("Trip");

    const result = await saveImage({ noteId: note.id, fileName: "x.png", data: new TextEncoder().encode("nope") });

    expect(result.name).toBeUndefined();
    expect(result.error).toMatch(/PNG, JPEG, GIF, and WebP/);
  });
});
