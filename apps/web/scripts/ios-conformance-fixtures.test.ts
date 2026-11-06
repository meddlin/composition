import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Writes the desktop-made databases the iPad app's Swift core is checked against (docs/ipad-app-design.md, "Keeping two
 * implementations honest"; apps/ios/CompositionCore). Not a test of the web app: it does nothing unless
 * `IOS_FIXTURE_DIR` is set, and then it makes
 *
 *   desktop-empty.db      a database `db.ts` created and nothing more (the Swift schema must match it exactly)
 *   desktop-populated.db  the same after real repo calls: notebooks, nested groups, notes, an attachment, and a trashed
 *                         note and group (the Swift pass must leave it unchanged)
 *
 * Run:  IOS_FIXTURE_DIR=/some/dir pnpm vitest run scripts/ios-conformance-fixtures.test.ts
 * then: COMPOSITION_CONFORMANCE_DIR=/some/dir swift test   (in apps/ios/CompositionCore)
 */

const outDir = process.env.IOS_FIXTURE_DIR;
const lib = path.resolve(__dirname, "../src/lib/composition");

/** Runs `build` against a brand-new data layer in a throwaway HOME and returns the closed database's path. */
async function makeDatabase(build: (repos: Repos) => void): Promise<string> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-ios-fixture-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.resetModules();
  const { getDb, closeDb } = await import(path.join(lib, "db"));
  getDb();
  build({
    notebooks: await import(path.join(lib, "notebooksRepo")),
    groups: await import(path.join(lib, "groupsRepo")),
    notes: await import(path.join(lib, "notesRepo")),
    trash: await import(path.join(lib, "trashRepo")),
    attachments: await import(path.join(lib, "attachmentsRepo")),
  });
  closeDb();
  return path.join(home, ".composition", "composition.db");
}

type Repos = {
  notebooks: typeof import("../src/lib/composition/notebooksRepo");
  groups: typeof import("../src/lib/composition/groupsRepo");
  notes: typeof import("../src/lib/composition/notesRepo");
  trash: typeof import("../src/lib/composition/trashRepo");
  attachments: typeof import("../src/lib/composition/attachmentsRepo");
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.skipIf(!outDir)("iPad conformance fixtures", () => {
  it("writes desktop-empty.db and desktop-populated.db", async () => {
    fs.mkdirSync(outDir!, { recursive: true });

    const empty = await makeDatabase(() => {});
    fs.copyFileSync(empty, path.join(outDir!, "desktop-empty.db"));

    const populated = await makeDatabase(({ notebooks, groups, notes, trash, attachments }) => {
      const work = notebooks.createNotebook("Work");
      const projects = groups.createGroup("Projects", null, work.id);
      const sub = groups.createGroup("Sub", projects.id);
      const alpha = notes.createNote("Alpha", "x,y");
      notes.createNote("Beta", "", projects.id);
      const gamma = notes.createNote("Gamma", "", sub.id);
      notes.updateNoteContent(alpha.id, "# Alpha\n\n<Info>Hello</Info>\n\nSee [Beta](note:2).\n");
      attachments.addAttachment(alpha.id, "report.pdf", "3f9c2a71b0de-report.pdf", 1234);
      trash.trashNote(gamma.id);
      const spare = groups.createGroup("Spare");
      trash.trashGroup(spare.id);
    });
    fs.copyFileSync(populated, path.join(outDir!, "desktop-populated.db"));

    expect(fs.existsSync(path.join(outDir!, "desktop-populated.db"))).toBe(true);
  });
});
