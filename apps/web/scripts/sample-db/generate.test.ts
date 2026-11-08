import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generate } from "./generate.mjs";

/**
 * The generator writes the final schema out by hand, so these open what it made through the real data layer: if
 * db.ts grows a column the generator doesn't know, the app would migrate a "fresh" sample database on first open
 * (a one-off cost that would skew every measurement taken on it), and the first test here says so.
 */

// Every database carries about 15 MB of fixed edge-case text, so one takes a second or two to write on a slow machine, and
// some tests write three. The 5 s default is too close to that.
vi.setConfig({ testTimeout: 30_000 });

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-sample-db-"));
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/composition/db");
  closeDb();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(dir, { recursive: true, force: true });
});

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: string | null }[])
    .map(({ name, type, notnull, dflt_value }) => `${name} ${type} ${notnull} ${dflt_value}`)
    .sort();

const indexes = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((row) => row.name)
    // The trash tables are empty and the app makes them on open; only the three the generator fills matter.
    .filter((name) => /^(idx|trg)_(notes|groups|notebooks)_/.test(name))
    .sort();

describe("sample database generator", () => {
  it("makes a database the app opens without migrating its notes, groups or notebooks", async () => {
    const { dbPath } = generate({ notes: 200, out: dir });
    const read = (file: string) => {
      const db = new Database(file, { readonly: true });
      const shape = { notes: columns(db, "notes"), groups: columns(db, "groups"), notebooks: columns(db, "notebooks"), indexes: indexes(db) };
      db.close();
      return shape;
    };
    const before = read(dbPath);

    vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(dir, "settings.json"));
    vi.resetModules();
    const { getDb } = await import("@/lib/composition/db");
    getDb();
    const { closeDb } = await import("@/lib/composition/db");
    closeDb();

    expect(read(dbPath)).toEqual(before);
  });

  it("is read by the app's own listing code", async () => {
    generate({ notes: 300, out: dir });
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(dir, "settings.json"));
    vi.resetModules();
    const { listNotes } = await import("@/lib/composition/notesRepo");
    const { listGroups } = await import("@/lib/composition/groupsRepo");
    const { listNotebooks } = await import("@/lib/composition/notebooksRepo");

    const notes = listNotes();
    const groups = listGroups();
    const notebooks = listNotebooks();

    expect(notes).toHaveLength(300);
    expect(new Set(notes.map((n) => n.uuid)).size).toBe(300);
    expect(notebooks.length).toBeGreaterThanOrEqual(2);
    const notebookIds = new Set(notebooks.map((n) => n.id));
    const groupById = new Map(groups.map((g) => [g.id, g]));
    for (const note of notes) {
      expect(notebookIds.has(note.notebookId)).toBe(true);
      // The app's invariant: a note in a group is in the group's notebook.
      if (note.groupId !== null) expect(groupById.get(note.groupId)?.notebookId).toBe(note.notebookId);
    }
    for (const group of groups) {
      expect(notebookIds.has(group.notebookId)).toBe(true);
      if (group.parentId !== null) expect(groupById.get(group.parentId)?.notebookId).toBe(group.notebookId);
    }
  });

  it("writes frontmatter and columns that agree, the way the app saves them", async () => {
    generate({ notes: 250, out: dir });
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(dir, "settings.json"));
    vi.resetModules();
    const { listNotes } = await import("@/lib/composition/notesRepo");
    const frontmatter = await import("@/lib/composition/frontmatter");

    for (const note of listNotes()) {
      const [fm] = frontmatter.parse(note.content);
      expect(fm, `note ${note.id} has a frontmatter block`).not.toBeNull();
      expect(fm!.title).toBe(note.title);
      expect(fm!.description).toBe(note.description);
      expect(frontmatter.tagsToString(fm!.tags)).toBe(note.tags);
      expect(note.updatedAt >= note.createdAt).toBe(true);
    }
  });

  it("links only to notes that exist, apart from the deliberately broken ones", async () => {
    generate({ notes: 400, out: dir });
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(dir, "settings.json"));
    vi.resetModules();
    const { listNotes } = await import("@/lib/composition/notesRepo");

    const notes = listNotes();
    const ids = new Set(notes.map((n) => n.id));
    for (const note of notes) {
      if (note.tags.split(",").includes("links")) continue;
      for (const [, id] of note.content.matchAll(/\]\(note:(\d+)\)/g)) expect(ids.has(Number(id))).toBe(true);
    }
  });

  it("gives the same database for the same seed, and a different one for another", () => {
    const digest = (out: string, seed: number) => {
      // Without the multi-megabyte documents: determinism is a property of the random stream, and this writes three databases.
      const { dbPath } = generate({ notes: 150, out, seed, huge: false });
      const db = new Database(dbPath, { readonly: true });
      const hash = crypto.createHash("sha256");
      for (const row of db.prepare("SELECT id, title, content, created_at, group_id, uuid FROM notes ORDER BY id").iterate()) hash.update(JSON.stringify(row));
      db.close();
      return hash.digest("hex");
    };

    const first = digest(path.join(dir, "a"), 7);

    expect(digest(path.join(dir, "b"), 7)).toBe(first);
    expect(digest(path.join(dir, "c"), 8)).not.toBe(first);
  });

  it("leaves out the huge notes on request, and keeps the same set otherwise", () => {
    const sizeOf = (out: string, huge: boolean) => {
      const { manifest } = generate({ notes: 150, out, huge });
      return manifest;
    };
    const withHuge = sizeOf(path.join(dir, "huge"), true);
    const without = sizeOf(path.join(dir, "lean"), false);

    expect(withHuge.contentBytes.max).toBeGreaterThan(2_000_000);
    expect(without.contentBytes.max).toBeLessThan(2_000_000);
    expect(withHuge.edgeCases).toBeGreaterThan(without.edgeCases);
    // The edge-case set doesn't depend on how many notes there are.
    expect(generate({ notes: 400, out: path.join(dir, "bigger") }).manifest.edgeCases).toBe(withHuge.edgeCases);
  });

  it("puts every note in one notebook, ungrouped, in the flat layout", () => {
    const { manifest } = generate({ notes: 150, out: dir, layout: "flat" });

    expect(manifest.notebooks).toHaveLength(1);
    expect(manifest.groups).toBe(0);
    expect(manifest.notebooks[0].ungroupedNotes).toBe(150);
  });

  it("refuses to overwrite a database unless told to, and to make one too small to hold the edge cases", () => {
    generate({ notes: 150, out: dir });

    expect(() => generate({ notes: 150, out: dir })).toThrow(/already exists/);
    expect(() => generate({ notes: 150, out: dir, force: true })).not.toThrow();
    expect(() => generate({ notes: 99, out: path.join(dir, "tiny") })).toThrow(/at least 100/);
    expect(() => generate({ notes: 100, out: path.join(dir, "small") })).toThrow(/too small/);
  });
});
