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
    });
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
