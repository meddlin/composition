import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listNotes, service } from "./backend";
import { createSandbox, frame, press, pressEscape, settle, sleep, type Sandbox, type Rendered } from "./testing";
import { AUTOSAVE_DELAY_MS } from "./components/Pane";

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox();
});
afterEach(async () => {
  await sandbox.dispose();
});

/** The note's text exactly as the database holds it. */
const stored = (title: string) => listNotes().find((note) => note.title === title)?.content ?? "";
const autosave = () => sleep(AUTOSAVE_DELAY_MS + 400);

async function seed() {
  const work = await service.createGroup("Work", null);
  await service.createNote("Plan", work.id);
  await service.createNote("Loose", null);
}

describe("the tree", () => {
  it("shows groups, their notes, the Ungrouped bucket and Settings", async () => {
    await seed();
    const app = await sandbox.mount();

    const screen = frame(app);
    expect(screen).toContain("▾ Work");
    expect(screen).toContain("Plan");
    expect(screen).toContain("▾ Ungrouped");
    expect(screen).toContain("Loose");
    expect(screen).toContain("⚙ Settings");
    expect(screen).toContain("No note open");
  });

  it("folds and unfolds a group with the arrow keys", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "ARROW_UP"); // from the first note up to the Work group
    await press(app, "ARROW_LEFT");
    expect(frame(app)).toContain("▸ Work");
    expect(frame(app)).not.toContain("  Plan");

    await press(app, "ARROW_RIGHT");
    expect(frame(app)).toContain("▾ Work");
    expect(frame(app)).toContain("Plan");
  });
});

describe("opening and editing a note", () => {
  it("opens the highlighted note in a pane with Enter and shows its text", async () => {
    await seed();
    const app = await sandbox.mount();

    await press(app, "RETURN", {}, 500);

    const screen = frame(app);
    expect(screen).toContain("Plan — saved");
    expect(screen).toContain("title: Plan"); // the editor shows the frontmatter
    expect(screen).not.toContain("No note open");
  });

  it("saves what you type shortly after you stop, and says so", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);

    await press(app, "END"); // to the end of the note
    await app.mockInput.typeText("\nA new thought.");
    await settle(app, 100);
    expect(frame(app)).toContain("saving…");

    await autosave();

    expect(stored("Plan")).toContain("A new thought.");
    expect(frame(app)).toContain("Plan — saved");
  });

  it("saves an undo too, which the editor reports no change event for", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);
    await press(app, "END");
    await app.mockInput.typeText("\nfirst");
    await autosave();
    expect(stored("Plan")).toContain("first");

    await app.mockInput.typeText(" second");
    await autosave();
    expect(stored("Plan")).toContain("first second");

    await press(app, "z", { ctrl: true });
    await autosave();
    expect(stored("Plan")).not.toContain("first second");
  });

  it("follows a title edited in the frontmatter into the tree", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);

    // "title: Plan" is the second line of the note: go there, to its end, and extend the title.
    await press(app, "ARROW_DOWN");
    await press(app, "e", { ctrl: true });
    await app.mockInput.typeText(" now");
    await autosave();

    expect(listNotes().map((n) => n.title)).toContain("Plan now");
    expect(frame(app)).toContain("Plan now");
  });
});


const arrowDown = (app: Rendered, times = 1) => (async () => { for (let i = 0; i < times; i++) await press(app, "ARROW_DOWN", {}, 40); })();
const arrowUp = (app: Rendered, times = 1) => (async () => { for (let i = 0; i < times; i++) await press(app, "ARROW_UP", {}, 40); })();
const inTree = (app: Rendered) => frame(app).includes("ctrl+g group");
const inPane = (app: Rendered) => frame(app).includes("ctrl+t view");

describe("panes", () => {
  it("opens a second note beside the first with o, and moves between them with ctrl+o", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400); // Plan, in the first pane
    await pressEscape(app);
    await arrowDown(app, 2); // Work > Plan > Ungrouped > Loose
    await press(app, "o", {}, 400);

    expect(frame(app)).toContain("Plan — saved");
    expect(frame(app)).toContain("Loose — saved");
    expect(inPane(app)).toBe(true);

    await press(app, "o", { ctrl: true }); // after the last pane comes the tree
    expect(inTree(app)).toBe(true);
    await press(app, "o", { ctrl: true }); // and from the tree, the first pane
    expect(inPane(app)).toBe(true);
  });

  it("closes the focused pane with ctrl+x and returns to the tree when none is left", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);

    await press(app, "x", { ctrl: true });

    expect(frame(app)).toContain("No note open");
    expect(inTree(app)).toBe(true);
  });

  it("cycles a pane's view with ctrl+t: split, editor, preview, split", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);
    expect(frame(app)).toContain("· split");

    await press(app, "t", { ctrl: true });
    expect(frame(app)).toContain("· editor");
    await press(app, "t", { ctrl: true });
    expect(frame(app)).toContain("· preview");
    await press(app, "t", { ctrl: true });
    expect(frame(app)).toContain("· split");
  });

  it("falls back to the editor in a pane too narrow for two columns", async () => {
    await seed();
    const app = await sandbox.mount({ width: 100 });
    await press(app, "RETURN", {}, 400);

    expect(frame(app)).toContain("· editor");
  });

  it("returns to the tree with Escape, and Escape in a dialog leaves the pane alone", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);
    expect(inPane(app)).toBe(true);

    await pressEscape(app);

    expect(inTree(app)).toBe(true);
    expect(frame(app)).toContain("Plan — saved");
  });

  it("types q into the editor instead of quitting", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);
    await app.mockInput.typeText("quick");
    await settle(app, 100);

    expect(frame(app)).toContain("quick");
    expect(inPane(app)).toBe(true);
  });
});

describe("creating", () => {
  it("makes a note in the highlighted group with ctrl+n and opens it", async () => {
    await seed();
    const app = await sandbox.mount();
    await arrowUp(app); // the Work group

    await press(app, "n", { ctrl: true });
    expect(frame(app)).toContain("New note");
    await app.mockInput.typeText("Brand new");
    await settle(app, 100);
    await press(app, "RETURN", {}, 500);

    const created = listNotes().find((n) => n.title === "Brand new");
    expect(created?.groupId).toBe((await service.loadWorkspace()).groups[0].id);
    expect(frame(app)).toContain("Brand new — saved");
    expect(frame(app)).not.toContain("New note");
  });

  it("makes a group inside the highlighted group with ctrl+g", async () => {
    await seed();
    const app = await sandbox.mount();
    await arrowUp(app);

    await press(app, "g", { ctrl: true });
    await app.mockInput.typeText("Projects");
    await settle(app, 100);
    await press(app, "RETURN", {}, 400);

    const { groups } = await service.loadWorkspace();
    const projects = groups.find((g) => g.name === "Projects");
    expect(projects?.parentId).toBe(groups.find((g) => g.name === "Work")?.id);
    expect(frame(app)).toContain("Projects");
  });

  it("creates nothing when the dialog is cancelled or the title is empty", async () => {
    await seed();
    const app = await sandbox.mount();

    await press(app, "n", { ctrl: true });
    await press(app, "RETURN", {}, 200); // empty title: ignored, dialog stays
    expect(frame(app)).toContain("New note");
    await pressEscape(app);

    expect(frame(app)).not.toContain("New note");
    expect(listNotes()).toHaveLength(2);
  });

  it("also makes a note from inside a pane", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);

    await press(app, "n", { ctrl: true });
    await app.mockInput.typeText("From a pane");
    await settle(app, 100);
    await press(app, "RETURN", {}, 500);

    expect(listNotes().map((n) => n.title)).toContain("From a pane");
  });
});

describe("deleting", () => {
  it("moves a note to the Trash Can after confirmation, and closes its pane", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);
    await pressEscape(app);

    await press(app, "d", { ctrl: true });
    expect(frame(app)).toContain('Move "Plan" to the Trash Can?');
    await press(app, "n"); // declined
    expect(listNotes().map((n) => n.title)).toContain("Plan");

    await press(app, "d", { ctrl: true });
    await press(app, "y", {}, 500);

    expect(listNotes().map((n) => n.title)).toEqual(["Loose"]);
    expect((await service.loadTrash()).notes.map((n) => n.title)).toEqual(["Plan"]);
    expect(frame(app)).toContain("No note open");
    expect(frame(app)).toContain('Moved "Plan" to the Trash Can.');
  });

  it("refuses to delete a group that still has notes, and says why", async () => {
    await seed();
    const app = await sandbox.mount();
    await arrowUp(app); // Work, which holds Plan

    await press(app, "d", { ctrl: true });

    expect(frame(app)).toContain("still has sub-groups or notes");
    expect((await service.loadWorkspace()).groups).toHaveLength(1);
  });

  it("deletes an empty group after confirmation", async () => {
    const empty = await service.createGroup("Empty", null);
    await service.createNote("Loose", null);
    const app = await sandbox.mount();
    await arrowUp(app, 2); // Empty comes first in the tree

    await press(app, "d", { ctrl: true });
    expect(frame(app)).toContain('Delete the empty group "Empty"?');
    await press(app, "y", {}, 400);

    expect((await service.loadWorkspace()).groups).toEqual([]);
    expect((await service.loadTrash()).groups.map((g) => g.id)).toEqual([empty.id]);
  });
});

describe("when the data layer fails", () => {
  it("says so and keeps running instead of crashing", async () => {
    await seed();
    const app = await sandbox.mount({
      api: {
        createNote: async () => {
          throw new Error("disk is full");
        },
      },
    });

    await press(app, "n", { ctrl: true });
    await app.mockInput.typeText("Doomed");
    await settle(app, 100);
    await press(app, "RETURN", {}, 400);

    expect(frame(app)).toContain("That didn't work: disk is full");
    expect(frame(app)).not.toContain("New note"); // the dialog is gone

    await press(app, "?"); // and the app still answers keys
    expect(frame(app)).toContain("Typing in an editor always wins");
  });
});

describe("renaming and moving", () => {
  it("renames a group with r, prefilled with its name", async () => {
    await seed();
    const app = await sandbox.mount();
    await arrowUp(app);

    await press(app, "r");
    expect(frame(app)).toContain("Rename group");
    expect(frame(app)).toContain("Work");
    await press(app, "u", { ctrl: true }); // clear the line
    await app.mockInput.typeText("Jobs");
    await settle(app, 100);
    await press(app, "RETURN", {}, 400);

    expect((await service.loadWorkspace()).groups.map((g) => g.name)).toEqual(["Jobs"]);
    expect(frame(app)).toContain("Jobs");
  });

  it("does nothing for r on a note", async () => {
    await seed();
    const app = await sandbox.mount();

    await press(app, "r");

    expect(frame(app)).not.toContain("Rename group");
  });

  it("moves a note to another group with m", async () => {
    await seed();
    const app = await sandbox.mount();
    await arrowDown(app, 2); // Loose

    await press(app, "m");
    expect(frame(app)).toContain("Move note to");
    await press(app, "ARROW_DOWN"); // Ungrouped, then Work
    await press(app, "RETURN", {}, 400);

    const { notes, groups } = await service.loadWorkspace();
    expect(notes.find((n) => n.title === "Loose")?.groupId).toBe(groups[0].id);
  });
});

describe("search", () => {
  it("filters the tree to what the search finds, and restores it when cleared", async () => {
    await seed();
    const loose = listNotes().find((n) => n.title === "Loose")!;
    const app = await sandbox.mount({
      api: { searchNotes: async () => ({ hits: [{ id: loose.id, title: "Loose", description: "" }] }) },
    });

    await press(app, "/");
    await app.mockInput.typeText("loose");
    await sleep(700);
    await settle(app, 100);

    let screen = frame(app);
    expect(screen).toContain("Loose");
    expect(screen).not.toContain("Work");
    expect(screen).not.toContain("Plan");

    await press(app, "u", { ctrl: true }); // clear the search
    await sleep(700);
    await settle(app, 100);
    screen = frame(app);
    expect(screen).toContain("Work");
    expect(screen).toContain("Plan");
  });

  it("says nothing matched when the search finds nothing", async () => {
    await seed();
    const app = await sandbox.mount({ api: { searchNotes: async () => ({ hits: [] }) } });

    await press(app, "/");
    await app.mockInput.typeText("zzz");
    await sleep(700);
    await settle(app, 100);

    expect(frame(app)).toContain("No notes match.");
  });

  it("shows why search is down and leaves the tree alone", async () => {
    await seed();
    const app = await sandbox.mount({
      api: { searchNotes: async () => ({ hits: [], error: "Search is unavailable: no binary." }) },
    });

    await press(app, " ", { ctrl: true }); // ctrl+space
    await app.mockInput.typeText("plan");
    await sleep(700);
    await settle(app, 100);

    expect(frame(app)).toContain("Search is unavailable: no binary.");
    expect(frame(app)).toContain("Plan");
    expect(frame(app)).toContain("Loose");
  });

  it("types q, o and other command letters into the search bar instead of acting on them", async () => {
    await seed();
    const app = await sandbox.mount({ api: { searchNotes: async () => ({ hits: [] }) } });
    await press(app, "/");

    await app.mockInput.typeText("quo");
    await settle(app, 100);

    expect(frame(app)).toContain("search: quo");
    expect(frame(app)).not.toContain("— saved"); // no pane opened, nothing was quit
  });
});

describe("help and quitting", () => {
  it("lists the keys with ? and closes with Escape", async () => {
    await seed();
    const app = await sandbox.mount();

    await press(app, "?");
    expect(frame(app)).toContain("ctrl+o");
    expect(frame(app)).toContain("Typing in an editor always wins");
    await pressEscape(app);

    expect(frame(app)).not.toContain("Typing in an editor always wins");
  });

  it("saves an edit that is still waiting when you quit", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "RETURN", {}, 400);
    await press(app, "END");
    await app.mockInput.typeText("\nlast words");
    await pressEscape(app, 30); // back to the tree well inside the autosave delay
    expect(stored("Plan")).not.toContain("last words");

    await press(app, "q", {}, 600);

    expect(stored("Plan")).toContain("last words");
  });
});
