import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "unavailable",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-notebooks-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

async function setup() {
  const service = await import("./service");
  const { notebooks } = await service.loadWorkspace();
  const work = notebooks[0];
  const home2 = await service.createNotebook("Home");
  return { service, work, home2 };
}

describe("notebooks", () => {
  it("starts with one notebook, which can be renamed", async () => {
    const service = await import("./service");
    const { notebooks } = await service.loadWorkspace();
    expect(notebooks.map((n) => n.name)).toEqual(["Notebook"]);

    const renamed = await service.renameNotebook(notebooks[0].id, "Work");
    expect(renamed.name).toBe("Work");
    expect((await service.loadWorkspace()).notebooks.map((n) => n.name)).toEqual(["Work"]);
  });

  it("puts new groups and notes in the notebook asked for, and sub-groups and grouped notes with their parent", async () => {
    const { service, work, home2 } = await setup();

    const top = await service.createGroup("Chores", null, home2.id);
    const sub = await service.createGroup("Garden", top.id, work.id);
    const inGroup = await service.createNote("Mow", top.id, work.id);
    const loose = await service.createNote("Loose", null, home2.id);
    const dflt = await service.createNote("Default");

    expect(top.notebookId).toBe(home2.id);
    expect(sub.notebookId).toBe(home2.id);
    expect(inGroup.notebookId).toBe(home2.id);
    expect(loose.notebookId).toBe(home2.id);
    expect(dflt.notebookId).toBe(work.id);
  });

  it("moves a group with its sub-groups and notes to the top level of another notebook", async () => {
    const { service, work, home2 } = await setup();
    const top = await service.createGroup("Projects", null, work.id);
    const sub = await service.createGroup("Alpha", top.id);
    const deep = await service.createNote("Spec", sub.id);
    const stay = await service.createGroup("Stays", null, work.id);

    const result = await service.moveGroupToNotebook(sub.id, home2.id);

    expect(result.group).toMatchObject({ id: sub.id, parentId: null, notebookId: home2.id });
    const ws = await service.loadWorkspace();
    expect(ws.notes.find((n) => n.id === deep.id)?.notebookId).toBe(home2.id);
    expect(ws.groups.find((g) => g.id === top.id)?.notebookId).toBe(work.id);
    expect(ws.groups.find((g) => g.id === stay.id)?.notebookId).toBe(work.id);
  });

  it("refuses to move a group to a notebook that doesn't exist", async () => {
    const { service, work } = await setup();
    const group = await service.createGroup("G", null, work.id);
    expect((await service.moveGroupToNotebook(group.id, 999)).error).toBeDefined();
  });

  it("keeps a note in its notebook when it is ungrouped, and follows a group when filed in one", async () => {
    const { service, work, home2 } = await setup();
    const group = await service.createGroup("Chores", null, home2.id);
    const note = await service.createNote("Mow", group.id);

    const out = await service.moveNoteToGroup(note.id, null);
    expect(out.notebookId).toBe(home2.id);

    const other = await service.createGroup("Elsewhere", null, work.id);
    expect((await service.moveNoteToGroup(note.id, other.id)).notebookId).toBe(work.id);
  });

  it("orders top-level groups within their own notebook only", async () => {
    const { service, work, home2 } = await setup();
    const a = await service.createGroup("A", null, work.id);
    const b = await service.createGroup("B", null, work.id);
    const other = await service.createGroup("Other", null, home2.id);

    await service.placeGroup(b.id, null, a.id);

    const ws = await service.loadWorkspace();
    const positioned = ws.groups.filter((g) => g.notebookId === work.id).map((g) => g.name);
    expect(positioned).toEqual(["B", "A"]);
    expect(ws.groups.find((g) => g.id === other.id)).toBeDefined();
  });

  it("deletes only an empty notebook, and never the last one", async () => {
    const { service, work, home2 } = await setup();
    await service.createGroup("G", null, home2.id);

    expect((await service.deleteNotebook(home2.id)).error).toMatch(/empty/);

    const spare = await service.createNotebook("Spare");
    expect(await service.deleteNotebook(spare.id)).toEqual({});
    expect((await service.loadWorkspace()).notebooks.map((n) => n.id)).toEqual([work.id, home2.id]);
  });

  it("refuses to delete the last notebook", async () => {
    const service = await import("./service");
    const { notebooks } = await service.loadWorkspace();
    expect((await service.deleteNotebook(notebooks[0].id)).error).toMatch(/last notebook/);
  });

  it("restores a trashed group to its notebook, or the first one if that notebook is gone", async () => {
    const { service, work, home2 } = await setup();
    const group = await service.createGroup("G", null, home2.id);
    await service.deleteGroup(group.id);

    await service.restoreGroup(group.id);
    expect((await service.loadWorkspace()).groups.find((g) => g.id === group.id)?.notebookId).toBe(home2.id);

    await service.deleteGroup(group.id);
    expect(await service.deleteNotebook(home2.id)).toEqual({});
    await service.restoreGroup(group.id);
    expect((await service.loadWorkspace()).groups.find((g) => g.id === group.id)?.notebookId).toBe(work.id);
  });

  it("restores a trashed note into its group's notebook", async () => {
    const { service, home2 } = await setup();
    const group = await service.createGroup("G", null, home2.id);
    const note = await service.createNote("N", group.id);
    await service.deleteNote(note.id);

    await service.restoreNote(note.id);

    expect((await service.loadWorkspace()).notes.find((n) => n.id === note.id)?.notebookId).toBe(home2.id);
  });
});

describe("notebook order", () => {
  it("lists notebooks in the order they were dragged into", async () => {
    const { service, work, home2 } = await setup();
    const third = await service.createNotebook("Third");

    let order = await service.placeNotebook(third.id, work.id);
    expect(order.map((n) => n.name)).toEqual(["Third", "Notebook", "Home"]);
    order = await service.placeNotebook(third.id, null);
    expect(order.map((n) => n.id)).toEqual([work.id, home2.id, third.id]);
    expect((await service.loadWorkspace()).notebooks.map((n) => n.id)).toEqual(order.map((n) => n.id));
  });
});
