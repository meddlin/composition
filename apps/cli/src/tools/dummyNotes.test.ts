import { describe, expect, it } from "vitest";
import { generateNotes, TAGS_POOL, TITLE_TEMPLATES, TOPICS } from "./dummyNotes";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

describe("generateNotes", () => {
  it("makes the number asked for, 100 by default", () => {
    expect(generateNotes(3, 1, NOW)).toHaveLength(3);
    expect(generateNotes(undefined, undefined, NOW)).toHaveLength(100);
    expect(generateNotes(0, 1, NOW)).toEqual([]);
  });

  it("gives the same notes for the same seed, and different ones for another", () => {
    expect(generateNotes(20, 7, NOW)).toEqual(generateNotes(20, 7, NOW));
    expect(generateNotes(20, 7, NOW)).not.toEqual(generateNotes(20, 8, NOW));
  });

  it("titles every note from a template and a topic", () => {
    const possible = new Set(TITLE_TEMPLATES.flatMap((template) => TOPICS.map((topic) => template.replace("{topic}", topic))));
    for (const note of generateNotes(50, 3, NOW)) expect(possible, note.title).toContain(note.title);
  });

  it("gives each note zero, one or two different tags from the pool", () => {
    for (const note of generateNotes(100, 5, NOW)) {
      const tags = note.tags === "" ? [] : note.tags.split(",");
      expect(tags.length).toBeLessThanOrEqual(2);
      expect(new Set(tags).size).toBe(tags.length);
      for (const tag of tags) expect(TAGS_POOL).toContain(tag);
    }
  });

  it("dates every note within the 400 days before now", () => {
    for (const note of generateNotes(100, 9, NOW)) {
      const age = (NOW - Date.parse(note.createdAt)) / 86_400_000;
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(400);
    }
  });

  it("writes a technical paragraph and then a capitalised filler paragraph", () => {
    const [note] = generateNotes(1, 2, NOW);
    const [snippet, filler] = note.body.trim().split("\n\n");
    expect(snippet.length).toBeGreaterThan(80);
    expect(filler).toMatch(/^[A-Z][a-z]+( [a-z]+)*\./);
  });

  it("covers every tag and a spread of topics across 100 notes", () => {
    const notes = generateNotes(100, 42, NOW);
    expect(new Set(notes.flatMap((n) => (n.tags ? n.tags.split(",") : []))).size).toBe(TAGS_POOL.length);
    expect(new Set(notes.map((n) => n.title)).size).toBeGreaterThan(40);
  });
});
