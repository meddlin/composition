import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, frontmatter, listNotes, searchIndex } from "../backend";
import { generateNotes } from "./dummyNotes";
import { seedNotes } from "./seedNotes";

let home: string;
beforeEach(() => {
  searchIndex.disableSearch("Search is off in tests.");
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-seed-"));
  const settings = path.join(home, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ appDataDir: path.join(home, "data"), theme: "dark" }));
  vi.stubEnv("COMPOSITION_SETTINGS_PATH", settings);
});
afterEach(() => {
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("seedNotes", () => {
  it("adds the notes, with real frontmatter and their own creation dates", async () => {
    const notes = generateNotes(25, 11, Date.parse("2026-10-02T00:00:00Z"));

    expect(await seedNotes(notes)).toBe(25);

    const stored = listNotes();
    expect(stored).toHaveLength(25);
    const first = notes[0];
    const match = stored.find((n) => n.title === first.title && n.createdAt === first.createdAt)!;
    expect(match.tags).toBe(first.tags);
    const [parsed, body] = frontmatter.parse(match.content);
    expect(parsed).toMatchObject({ title: first.title, createdAt: first.createdAt, updatedAt: first.createdAt });
    expect(parsed?.tags.join(",")).toBe(first.tags);
    expect(body).toBe(first.body);
  });

  it("can seed a database that already holds notes, without touching them", async () => {
    await seedNotes(generateNotes(3, 1));
    await seedNotes(generateNotes(4, 2));

    expect(listNotes()).toHaveLength(7);
  });
});
