import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as frontmatter from "@/lib/composition/frontmatter";
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

describe("line-count notes", () => {
  const readNotes = (dbPath: string) => {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT id, title, content, tags, group_id, notebook_id FROM notes ORDER BY id").all() as {
      id: number;
      title: string;
      content: string;
      tags: string;
      group_id: number | null;
      notebook_id: number;
    }[];
    db.close();
    return rows;
  };
  const bodyOf = (content: string) => frontmatter.parse(content)[1];
  const linesIn = (text: string) => (text.match(/\n/g) ?? []).length;

  it("adds a note of exactly each line count, after the others, ungrouped, in the first notebook", () => {
    const { dbPath, manifest } = generate({ notes: 150, out: dir, seed: 3, huge: false, lineNotes: [500, 5000, 10000] });
    const notes = readNotes(dbPath);
    const added = notes.filter((n) => n.title.startsWith("LINES: "));

    expect(notes).toHaveLength(153);
    expect(added.map((n) => n.title)).toEqual(["LINES: 500 lines", "LINES: 5,000 lines", "LINES: 10,000 lines"]);
    expect(added.map((n) => n.id)).toEqual([151, 152, 153]);
    expect(added.map((n) => linesIn(bodyOf(n.content)))).toEqual([500, 5000, 10000]);
    for (const note of added) {
      expect(note.group_id).toBeNull();
      expect(note.notebook_id).toBe(1);
      expect(note.tags).toBe("line-count,mixed");
    }
    expect(manifest.lineNotes?.map((n) => [n.lines, n.profile])).toEqual([[500, "mixed"], [5000, "mixed"], [10000, "mixed"]]);
    // The count excludes the frontmatter block, which every note carries on top.
    expect(frontmatter.parse(added[0].content)[0]?.title).toBe("LINES: 500 lines");
  });

  it("never changes any other note, and writes no manifest entry when none were asked for", () => {
    const base = generate({ notes: 150, out: path.join(dir, "base"), seed: 3, huge: false });
    const withLines = generate({ notes: 150, out: path.join(dir, "with"), seed: 3, huge: false, lineNotes: [500, 5000] });
    const others = (dbPath: string) => readNotes(dbPath).filter((n) => n.id <= 150);

    expect(others(withLines.dbPath)).toEqual(others(base.dbPath));
    expect(base.manifest.lineNotes).toBeUndefined();
    expect(withLines.manifest.lineNotes).toHaveLength(2);
  });

  it("gives the same notes for the same seed and different ones for another", () => {
    const body = (seed: number, name: string) =>
      readNotes(generate({ notes: 150, out: path.join(dir, name), seed, huge: false, lineNotes: [500] }).dbPath).at(-1)!.content;

    const first = body(5, "a");

    expect(body(5, "b")).toBe(first);
    expect(body(6, "c")).not.toBe(first);
  });

  it("makes the mixed profile a real long note: headings, and code fences that all close", () => {
    const { dbPath } = generate({ notes: 150, out: dir, seed: 1, huge: false, lineNotes: [500, 5000, 10000] });
    for (const note of readNotes(dbPath).filter((n) => n.title.startsWith("LINES: "))) {
      const body = bodyOf(note.content);
      const lines = linesIn(body);
      const headings = (body.match(/^#{1,6} /gm) ?? []).length;
      const fences = (body.match(/^```/gm) ?? []).length;

      // About one heading every 25 lines: well away from none, and from one a line.
      expect(headings, note.title).toBeGreaterThan(lines / 60);
      expect(headings, note.title).toBeLessThan(lines / 10);
      expect(fences % 2, `${note.title}: every code fence closes`).toBe(0);
      expect(fences, note.title).toBeGreaterThan(0);
    }
  });

  it("makes the plain profile wrapped paragraphs and nothing else", () => {
    const { dbPath, manifest } = generate({ notes: 150, out: dir, seed: 1, huge: false, lineNotes: [500, 5000], lineProfile: "plain" });
    for (const note of readNotes(dbPath).filter((n) => n.title.startsWith("LINES: "))) {
      const body = bodyOf(note.content);

      expect(note.tags).toBe("line-count,plain");
      expect(body).not.toMatch(/^(#|```|[-*>|]|\d+\.)/m);
      expect(Math.max(...body.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
      expect(body).toContain("\n\n");
    }
    expect(manifest.lineNotes?.every((n) => n.profile === "plain")).toBe(true);
  });

  it("reads back through the app's own note listing", async () => {
    generate({ notes: 150, out: dir, seed: 1, huge: false, lineNotes: [500] });
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(dir, "settings.json"));
    vi.resetModules();
    const { listNotes } = await import("@/lib/composition/notesRepo");

    const found = listNotes().find((n) => n.title === "LINES: 500 lines");
    expect(found?.uuid).toMatch(/^[0-9a-f]{32}$/);
    expect(found?.notebookId).toBe(1);
  });

  it("refuses a bad list of line counts or a profile it does not know", () => {
    const out = (name: string) => path.join(dir, name);

    expect(() => generate({ notes: 150, out: out("a"), lineNotes: [0] })).toThrow(/line-notes/);
    expect(() => generate({ notes: 150, out: out("b"), lineNotes: [2_000_000] })).toThrow(/line-notes/);
    expect(() => generate({ notes: 150, out: out("c"), lineNotes: [500, 500] })).toThrow(/line-notes/);
    expect(() => generate({ notes: 150, out: out("d"), lineNotes: [1.5] })).toThrow(/line-notes/);
    expect(() => generate({ notes: 150, out: out("e"), lineNotes: [500], lineProfile: "fancy" })).toThrow(/line-profile/);
  });
});
