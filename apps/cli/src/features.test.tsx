import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, listNotes, loadWebSettings, resolvedDbPath, service, sunLevel, type SunEvent } from "./backend";
import { moveApplicationData } from "./dataLocation";
import { backgroundAt, createSandbox, frame, press, pressEscape, settle, sleep, type Rendered, type Sandbox } from "./testing";

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox();
});
afterEach(async () => {
  await sandbox.dispose();
});

const arrowDown = async (app: Rendered, times = 1) => {
  for (let i = 0; i < times; i++) await press(app, "ARROW_DOWN", {}, 40);
};
const arrowUp = async (app: Rendered, times = 1) => {
  for (let i = 0; i < times; i++) await press(app, "ARROW_UP", {}, 40);
};
const inTree = (app: Rendered) => frame(app).includes("q quit");
/** Only the centered dialog, not the tree showing around it. (The dialog is 60 wide on a 120-wide screen.) */
const dialogText = (app: Rendered) => frame(app).split("\n").map((row) => row.slice(30, 90)).join("\n");

async function seed() {
  const work = await service.createGroup("Work", null);
  await service.createNote("Plan", work.id);
  await service.createNote("Loose", null);
  return work;
}

describe("favorites", () => {
  it("pins the highlighted note with f, lists it above the tree, and remembers it", async () => {
    await seed();
    const app = await sandbox.mount();

    await press(app, "f", {}, 300);

    expect(frame(app)).toContain('Pinned "Plan" to Favorites.');
    expect(frame(app)).toContain("★ Favorites");
    expect(frame(app)).toContain("Plan ★"); // starred where it also sits in the tree
    expect((await service.loadWorkspace()).favorites).toEqual([{ type: "note", id: listNotes().find((n) => n.title === "Plan")!.id }]);
  });

  it("keeps the pinned list across a restart", async () => {
    await seed();
    const first = await sandbox.mount();
    await press(first, "f", {}, 300);

    const second = await sandbox.mount();

    expect(frame(second)).toContain("★ Favorites");
  });

  it("unpins with f again, and stays on the same note", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "f", {}, 300);
    await arrowUp(app, 2); // from Plan up past Work onto the favorite entry
    expect(frame(app)).toContain("★ Favorites");

    await press(app, "f", {}, 300);

    expect(frame(app)).toContain('Unpinned "Plan".');
    expect(frame(app)).not.toContain("★ Favorites");
    expect((await service.loadWorkspace()).favorites).toEqual([]);
  });

  it("opens a pinned note from the Favorites section", async () => {
    await seed();
    const app = await sandbox.mount();
    await arrowDown(app, 2); // Loose
    await press(app, "f", {}, 300);
    await arrowUp(app, 99); // to the very top: the section header
    await press(app, "ARROW_DOWN"); // the favorite entry

    await press(app, "RETURN", {}, 500);

    expect(frame(app)).toContain("Loose — saved");
  });

  it("pins a group, and Enter on its entry jumps to the group in the tree", async () => {
    const work = await seed();
    const app = await sandbox.mount();
    await arrowUp(app); // the Work group
    await press(app, "f", {}, 300);
    expect(frame(app)).toContain("◆ Work");
    await arrowUp(app, 99);
    await press(app, "ARROW_DOWN"); // the favorite group entry

    await press(app, "RETURN", {}, 300);
    await press(app, "r", {}, 300); // rename acts on whatever the cursor is on: now the real group

    expect(frame(app)).toContain("Rename group");
    expect((await service.loadWorkspace()).favorites).toEqual([{ type: "group", id: work.id }]);
  });

  it("folds the section with the arrow keys", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "f", {}, 300);
    await arrowUp(app, 99);

    await press(app, "ARROW_LEFT");
    expect(frame(app)).toContain("▸ ★ Favorites");
    expect(frame(app)).not.toContain("  Plan\n");

    await press(app, "ARROW_RIGHT");
    expect(frame(app)).toContain("▾ ★ Favorites");
  });

  it("drops a pinned note when it is deleted", async () => {
    await seed();
    const app = await sandbox.mount();
    await press(app, "f", {}, 300);
    await arrowDown(app); // down off the entry onto the group header, then the real Plan row
    await arrowDown(app, 2);
    await arrowUp(app, 99);
    await arrowDown(app, 3); // header, entry, Work, Plan: land on the note's own row

    await press(app, "d", { ctrl: true });
    await press(app, "y", {}, 600);

    expect(listNotes().map((n) => n.title)).toEqual(["Loose"]);
    expect((await service.loadWorkspace()).favorites).toEqual([]);
    expect(frame(app)).not.toContain("★ Favorites");
  });

  it("hides the section while a search is filtering the tree", async () => {
    await seed();
    const loose = listNotes().find((n) => n.title === "Loose")!;
    const app = await sandbox.mount({
      api: { searchNotes: async () => ({ hits: [{ id: loose.id, title: "Loose", description: "" }] }) },
    });
    await press(app, "f", {}, 300);

    await press(app, "/");
    await app.mockInput.typeText("loose");
    await sleep(700);
    await settle(app, 100);

    expect(frame(app)).not.toContain("★ Favorites");
  });
});

describe("moving a group", () => {
  it("moves a group under another with m", async () => {
    const work = await seed();
    const home = await service.createGroup("Home", null);
    const app = await sandbox.mount();
    await arrowUp(app); // Home sorts before Work: land on the first group
    await arrowUp(app, 5);

    await press(app, "m");
    expect(frame(app)).toContain('Move "Home" to');
    expect(frame(app)).toContain("Work");
    await press(app, "ARROW_DOWN"); // from Work (the only target) ...
    await press(app, "RETURN", {}, 400);

    const groups = (await service.loadWorkspace()).groups;
    expect(groups.find((g) => g.id === home.id)?.parentId).toBe(work.id);
  });

  it("offers the top level, and never the group itself or anything beneath it", async () => {
    const work = await service.createGroup("Work", null);
    const projects = await service.createGroup("Projects", work.id);
    await service.createGroup("Archive", projects.id);
    await service.createGroup("Home", null);
    await service.createNote("Loose", null);
    const app = await sandbox.mount();
    await arrowUp(app, 99); // Home (names sort: Home, Work)

    await press(app, "m"); // Home is already top level, so that isn't offered; Work and the groups under it are
    let screen = dialogText(app);
    expect(screen).not.toContain("Top level");
    expect(screen).toContain("Archive");
    await pressEscape(app);

    await arrowDown(app, 1); // Work
    await press(app, "m");
    screen = dialogText(app);
    expect(screen).toContain('Move "Work" to');
    expect(screen).not.toContain("Projects"); // beneath it
    expect(screen).not.toContain("Archive");
    expect(screen).toContain("Home");
  });

  it("says so when there is nowhere to move a group", async () => {
    await service.createGroup("Only", null);
    await service.createNote("Loose", null);
    const app = await sandbox.mount();
    await arrowUp(app, 99);

    await press(app, "m");

    expect(frame(app)).toContain('There is nowhere else to move "Only".');
  });

  it("moves a nested group back to the top level", async () => {
    const work = await service.createGroup("Work", null);
    const sub = await service.createGroup("Sub", work.id);
    await service.createNote("Loose", null);
    const app = await sandbox.mount();
    await arrowUp(app, 99);
    await arrowDown(app); // Sub (inside Work)

    await press(app, "m");
    expect(frame(app)).toContain("Top level");
    await press(app, "RETURN", {}, 400); // the first option is Top level

    expect((await service.loadWorkspace()).groups.find((g) => g.id === sub.id)?.parentId).toBeNull();
  });
});

describe("color schemes", () => {
  const BACKGROUNDS: [string, string][] = [
    ["dark", "#121212"],
    ["light", "#F7F7F4"],
    ["forest", "#0C1510"],
    ["cream", "#F6F0E1"],
  ];

  it.each(BACKGROUNDS)("draws the %s scheme's background", async (theme, background) => {
    await seed();
    const app = await sandbox.mount({ theme });

    expect(backgroundAt(app, 5, 70)).toBe(background);
  });

  it("falls back to dark for a scheme name it doesn't know", async () => {
    await seed();
    const app = await sandbox.mount({ theme: "neon" });

    expect(backgroundAt(app, 5, 70)).toBe("#121212");
  });
});

describe("follow the sun", () => {
  /** Sunrise and sunset around `now`, so that it is daytime (level 1) or night (level 0). */
  function scheduleFor(level: 0 | 1) {
    const now = Date.now();
    const hour = 3600_000;
    const events: SunEvent[] =
      level === 1
        ? [{ at: now - 6 * hour, kind: "sunrise" }, { at: now + 6 * hour, kind: "sunset" }]
        : [{ at: now - 6 * hour, kind: "sunset" }, { at: now + 6 * hour, kind: "sunrise" }];
    return { events, level: sunLevel(events, now), estimated: false, retry: false };
  }

  it("draws the light scheme in the daytime", async () => {
    await seed();
    const app = await sandbox.mount({ theme: "auto", api: { loadSunSchedule: async () => scheduleFor(1) } });
    await settle(app, 400);

    expect(backgroundAt(app, 5, 70)).toBe("#F7F7F4");
  });

  it("draws the dark scheme at night", async () => {
    await seed();
    const app = await sandbox.mount({ theme: "auto", api: { loadSunSchedule: async () => scheduleFor(0) } });
    await settle(app, 400);

    expect(backgroundAt(app, 5, 70)).toBe("#121212");
  });

  it("asks for the schedule only while that scheme is on", async () => {
    await seed();
    let asked = 0;
    const app = await sandbox.mount({
      theme: "dark",
      api: { loadSunSchedule: async () => (asked++, scheduleFor(1)) },
    });
    await settle(app, 300);

    expect(asked).toBe(0);
  });
});

describe("the Settings screen", () => {
  /** Opens Settings: it is the last row of the tree. */
  async function openSettings(app: Rendered) {
    await arrowDown(app, 12);
    await press(app, "RETURN", {}, 500);
  }

  it("opens from the Settings row and goes back with Escape", async () => {
    await seed();
    const app = await sandbox.mount();

    await openSettings(app);
    expect(frame(app)).toContain("Application data location");
    expect(frame(app)).toContain("Color scheme");
    expect(frame(app)).toContain("City, for follow the sun");
    expect(frame(app)).toContain(path.join(sandbox.home, "data"));

    await pressEscape(app, 300);
    expect(frame(app)).not.toContain("Application data location");
    expect(inTree(app)).toBe(true);
  });

  it("applies and remembers a color scheme chosen with Enter", async () => {
    await seed();
    const app = await sandbox.mount();
    await openSettings(app);
    await press(app, "TAB"); // to the color scheme list
    await press(app, "ARROW_DOWN"); // Light

    await press(app, "RETURN", {}, 500);

    expect(frame(app)).toContain("Color scheme: Light.");
    expect(loadWebSettings().theme).toBe("light");
    expect(backgroundAt(app, 20, 70)).toBe("#F7F7F4");
  });

  it("lists all five schemes and marks the one in use", async () => {
    await seed();
    const app = await sandbox.mount({ theme: "forest" });
    await openSettings(app);

    for (const label of ["Dark", "Light", "Forest", "Cream", "Follow the sun"]) {
      expect(frame(app)).toContain(label);
    }
    expect(frame(app)).toContain("● Forest");
    expect(frame(app)).not.toContain("● Dark");
  });

  it("saves a city and shows today's sunrise and sunset", async () => {
    await seed();
    const saved: string[] = [];
    const app = await sandbox.mount({
      api: {
        saveLocation: async (city) => (saved.push(city), { saved: { name: "Austin, Texas, United States", sunrise: "7:12 AM", sunset: "7:38 PM" } }),
      },
    });
    await openSettings(app);
    await press(app, "TAB");
    await press(app, "TAB"); // to the city field
    await app.mockInput.typeText("Austin");
    await settle(app, 100);

    await press(app, "RETURN", {}, 500);

    expect(saved).toEqual(["Austin"]);
    expect(frame(app)).toContain("Saved Austin, Texas, United States: sunrise 7:12 AM, sunset 7:38 PM.");
  });

  it("shows why a city could not be saved", async () => {
    await seed();
    const app = await sandbox.mount({
      api: { saveLocation: async () => ({ error: 'Couldn\'t find a city matching "Nowhere".' }) },
    });
    await openSettings(app);
    await press(app, "TAB");
    await press(app, "TAB");
    await app.mockInput.typeText("Nowhere");
    await settle(app, 100);

    await press(app, "RETURN", {}, 500);

    expect(frame(app)).toContain("Couldn't find a city matching");
  });

  it("moves all the data to a new folder, and the notes are still there", async () => {
    await seed();
    const destination = path.join(sandbox.home, "moved-data");
    const app = await sandbox.mount({
      moveDataLocation: async (to) => {
        closeDb();
        moveApplicationData(loadWebSettings(), to);
      },
    });
    await openSettings(app);
    await press(app, "u", { ctrl: true }); // clear the field
    await app.mockInput.typeText(destination);
    await settle(app, 100);

    await press(app, "RETURN", {}, 800);

    expect(frame(app)).toContain(`Application data moved to ${destination}.`);
    expect(resolvedDbPath(loadWebSettings())).toBe(path.join(destination, "composition.db"));
    expect(fs.existsSync(path.join(destination, "composition.db"))).toBe(true);
    expect(listNotes().map((n) => n.title).sort()).toEqual(["Loose", "Plan"]);
  });

  it("says when the location is unchanged, empty, or the move fails", async () => {
    await seed();
    const app = await sandbox.mount({
      moveDataLocation: async () => {
        throw new Error("The new location already contains Composition data: x");
      },
    });
    await openSettings(app);

    await press(app, "RETURN", {}, 300); // the current location, untouched
    expect(frame(app)).toContain("That is where the data already is.");

    await press(app, "u", { ctrl: true });
    await press(app, "RETURN", {}, 300);
    expect(frame(app)).toContain("Application data location cannot be empty.");

    await app.mockInput.typeText("/somewhere/else");
    await settle(app, 100);
    await press(app, "RETURN", {}, 500);
    expect(frame(app)).toContain("The new location already contains Composition data");
  });

  describe("backup and restore", () => {
    beforeEach(() => {
      // The "pre-restore" backup goes to ~/Composition Backups; keep that inside the sandbox.
      vi.stubEnv("HOME", sandbox.home);
    });

    /** Tab past the path, color scheme and city fields. */
    async function tabTo(app: Rendered, field: "backup" | "restore") {
      for (let i = 0; i < (field === "backup" ? 3 : 4); i++) await press(app, "TAB");
    }

    it("offers the default backup folder, and creates a backup in it with Enter", async () => {
      await seed();
      const app = await sandbox.mount();
      await openSettings(app);
      await tabTo(app, "backup");
      expect(frame(app)).toContain(path.join(sandbox.home, "Composition Backups"));

      await press(app, "RETURN", {}, 800);

      const folder = path.join(sandbox.home, "Composition Backups");
      const [file] = fs.readdirSync(folder);
      expect(file).toMatch(/^composition-backup-.*\.tar\.gz$/);
      expect(frame(app)).toContain("Backed up 2 notes, 1 group, 0 images and 0 attached files to");
    });

    it("backs up into a folder that was typed", async () => {
      await seed();
      const target = path.join(sandbox.home, "usb");
      const app = await sandbox.mount();
      await openSettings(app);
      await tabTo(app, "backup");
      await press(app, "u", { ctrl: true });
      await app.mockInput.typeText(target);
      await settle(app, 100);

      await press(app, "RETURN", {}, 800);

      expect(fs.readdirSync(target)).toHaveLength(1);
    });

    it("shows why a backup could not be made", async () => {
      await seed();
      const app = await sandbox.mount();
      await openSettings(app);
      await tabTo(app, "backup");
      await press(app, "u", { ctrl: true });
      await app.mockInput.typeText("not/an/absolute/path");
      await settle(app, 100);

      await press(app, "RETURN", {}, 500);

      expect(frame(app)).toContain("Enter the full path");
    });

    async function lostEverythingAfterABackup() {
      await seed();
      const { file } = await service.createBackup(path.join(sandbox.home, "backups"));
      const [note] = listNotes();
      await service.deleteNote(note.id);
      await service.permanentlyDeleteNote(note.id);
      await service.createNote("Written after the backup", null);
      return file!;
    }

    it("asks before restoring, and replaces everything once y is pressed", async () => {
      const file = await lostEverythingAfterABackup();
      const app = await sandbox.mount();
      await openSettings(app);
      await tabTo(app, "restore");
      await app.mockInput.typeText(file);
      await settle(app, 100);

      await press(app, "RETURN", {}, 300);
      expect(frame(app)).toContain("Press y to replace EVERYTHING");
      expect(listNotes().map((n) => n.title)).toContain("Written after the backup"); // nothing happened yet

      await press(app, "y", {}, 1000);

      expect(frame(app)).toContain("Restored 2 notes, 1 group");
      expect(listNotes().map((n) => n.title).sort()).toEqual(["Loose", "Plan"]);
      // The tree behind Settings shows the restored notes, not the ones that were replaced.
      await pressEscape(app, 300);
      expect(frame(app)).toContain("Plan");
      expect(frame(app)).not.toContain("Written after the backup");
    });

    it("does nothing when any other key answers the question", async () => {
      const file = await lostEverythingAfterABackup();
      const app = await sandbox.mount();
      await openSettings(app);
      await tabTo(app, "restore");
      await app.mockInput.typeText(file);
      await settle(app, 100);
      await press(app, "RETURN", {}, 300);

      await press(app, "n", {}, 300);

      expect(frame(app)).toContain("Restore cancelled.");
      expect(listNotes().map((n) => n.title)).toContain("Written after the backup");
    });

    it("refuses a file that is not a backup, and changes nothing", async () => {
      await seed();
      const junk = path.join(sandbox.home, "junk.tar.gz");
      fs.writeFileSync(junk, "definitely not a backup");
      const app = await sandbox.mount();
      await openSettings(app);
      await tabTo(app, "restore");
      await app.mockInput.typeText(junk);
      await settle(app, 100);
      await press(app, "RETURN", {}, 300);

      await press(app, "y", {}, 800);

      expect(frame(app)).toContain("not a Composition backup");
      expect(listNotes().map((n) => n.title).sort()).toEqual(["Loose", "Plan"]);
    });

    it("asks for a path when there is none", async () => {
      await seed();
      const app = await sandbox.mount();
      await openSettings(app);
      await tabTo(app, "restore");

      await press(app, "RETURN", {}, 300);

      expect(frame(app)).toContain("Enter the path of a backup file.");
    });
  });

  it("cannot move the data where the app has no way to", async () => {
    await seed();
    const app = await sandbox.mount(); // no moveDataLocation
    await openSettings(app);
    await press(app, "u", { ctrl: true });
    await app.mockInput.typeText("/elsewhere");
    await settle(app, 100);

    await press(app, "RETURN", {}, 400);

    expect(frame(app)).toContain("Moving the data isn't available here.");
  });
});
