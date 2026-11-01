import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Meilisearch is the boundary: a stub records what the search is told, and says whether the app has it switched off.
const search = vi.hoisted(() => ({ indexNote: vi.fn<(note: { id: number }) => Promise<void>>(async () => {}), disabled: false }));
vi.mock("./searchIndex", () => ({ indexNote: search.indexNote, searchIsDisabled: () => search.disabled }));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-report-index-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
  search.indexNote.mockClear();
  search.indexNote.mockImplementation(async () => {});
  search.disabled = false;
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

async function load() {
  const { indexReportNotes } = await import("./todoReportIndex");
  const notes = await import("./notesRepo");
  return { indexReportNotes, notes };
}

describe("telling the search about report notes", () => {
  it("indexes the notes it is given, and passes over one that has been deleted since", async () => {
    const { indexReportNotes, notes } = await load();
    const one = notes.createNote("Weekly one");
    const two = notes.createNote("Weekly two");

    await indexReportNotes([one.id, 999, two.id]);

    expect(search.indexNote.mock.calls.map(([note]) => note.id)).toEqual([one.id, two.id]);
  });

  it("does nothing, and says nothing, while the app has search switched off because it is still starting", async () => {
    const { indexReportNotes, notes } = await load();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const one = notes.createNote("Weekly one");
    search.disabled = true;

    await indexReportNotes([one.id]);

    expect(search.indexNote).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("logs a note it cannot index and goes on to the next", async () => {
    const { indexReportNotes, notes } = await load();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const one = notes.createNote("Weekly one");
    const two = notes.createNote("Weekly two");
    search.indexNote.mockRejectedValueOnce(new Error("connection refused"));

    await indexReportNotes([one.id, two.id]);

    expect(error).toHaveBeenCalledTimes(1);
    expect(search.indexNote.mock.calls.map(([note]) => note.id)).toEqual([one.id, two.id]);
  });
});
