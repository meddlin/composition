import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Meilisearch isn't running in tests; indexing is best-effort, so a stub keeps the suite quiet.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "Search is unavailable.",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-panels-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const document = { version: 1, windows: { main: { layout: { type: "panel", id: "p1" }, panels: { p1: { kind: "empty", state: null } } } } };

describe("the saved panels", () => {
  it("are nothing until some are saved", async () => {
    const { loadPanels } = await import("./panelsService");

    expect(await loadPanels()).toBeUndefined();
  });

  it("come back as they were saved", async () => {
    const { loadPanels, savePanels } = await import("./panelsService");

    await savePanels(document);

    expect(await loadPanels()).toEqual(document);
  });

  it("survive the other settings being saved, and leave them alone", async () => {
    const { loadPanels, savePanels } = await import("./panelsService");
    const { saveLayout, saveFavorites } = await import("./service");
    const { loadWebSettings } = await import("./webSettings");
    await savePanels(document);

    await saveLayout({ sidebarWidth: 300, editorRatio: 0.4 });
    await saveFavorites([{ type: "note", id: 1 }]);

    expect(await loadPanels()).toEqual(document);
    expect(loadWebSettings()).toMatchObject({ sidebarWidth: 300, editorRatio: 0.4, favorites: [{ type: "note", id: 1 }] });
  });

  it("are forgotten, not kept, when what is saved is not an object", async () => {
    const { loadPanels, savePanels } = await import("./panelsService");
    await savePanels(document);

    for (const junk of [null, undefined, "panels", 7, ["a"]]) {
      await savePanels(junk);
      expect(await loadPanels(), JSON.stringify(junk)).toBeUndefined();
    }
  });

  it("are ignored when the settings file holds something else under their name", async () => {
    const { loadPanels } = await import("./panelsService");
    const { settingsPath } = await import("./webSettings");
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({ panels: "not an object" }));

    expect(await loadPanels()).toBeUndefined();
  });
});

describe("notes in the Trash Can, read for a panel that was showing one", () => {
  async function trashed(...titles: string[]) {
    const { createNote } = await import("./notesRepo");
    const { trashNote } = await import("./trashRepo");
    const notes = titles.map((title) => createNote(title));
    for (const note of notes) trashNote(note.id);
    return notes;
  }

  it("come back whole, only those asked for that are in the trash", async () => {
    const [first, second] = await trashed("First", "Second");
    const { createNote } = await import("./notesRepo");
    const kept = createNote("Not trashed");
    const { loadTrashedNotes } = await import("./panelsService");

    const found = await loadTrashedNotes([first.id, kept.id, 9999]);

    expect(found).toEqual([first]);
    expect(found.some((note) => note.id === second.id)).toBe(false);
  });

  it("leave the Trash Can as it was, so the notes can still be restored", async () => {
    const [note] = await trashed("Still there");
    const { loadTrashedNotes } = await import("./panelsService");
    const { listTrash } = await import("./trashRepo");

    await loadTrashedNotes([note.id]);

    expect(listTrash().notes.map((n) => n.id)).toEqual([note.id]);
  });

  it("are none for no ids", async () => {
    const { loadTrashedNotes } = await import("./panelsService");

    expect(await loadTrashedNotes([])).toEqual([]);
  });
});
