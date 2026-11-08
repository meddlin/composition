import { describe, expect, it } from "vitest";
import { describeCounts, type BackupCounts } from "./backupApi";

const counts = (overrides: Partial<BackupCounts> = {}): BackupCounts => ({
  notes: 12,
  groups: 3,
  trashedNotes: 0,
  trashedGroups: 0,
  images: 4,
  attachments: 1,
  documents: 0,
  todos: 0,
  archivedTodos: 0,
  contacts: 0,
  ...overrides,
});

describe("describeCounts", () => {
  it("reads as it always has when there are no to-dos at all", () => {
    expect(describeCounts(counts())).toBe("12 notes, 3 groups, 4 images and 1 attached file");
    expect(describeCounts(counts({ notes: 1, groups: 1, images: 1, attachments: 2 }))).toBe(
      "1 note, 1 group, 1 image and 2 attached files",
    );
  });

  it("adds the PDFs after the attached files, in the singular for one", () => {
    expect(describeCounts(counts({ documents: 3 }))).toBe("12 notes, 3 groups, 4 images, 1 attached file and 3 PDFs");
    expect(describeCounts(counts({ documents: 1, todos: 8 }))).toBe("12 notes, 3 groups, 4 images, 1 attached file, 1 PDF and 8 to-dos");
  });

  it("adds the to-dos, and how many of them are archived", () => {
    expect(describeCounts(counts({ todos: 8, archivedTodos: 31 }))).toBe(
      "12 notes, 3 groups, 4 images, 1 attached file and 8 to-dos (31 archived)",
    );
  });

  it("leaves out the archive when it is empty, and says to-do in the singular", () => {
    expect(describeCounts(counts({ todos: 8 }))).toBe("12 notes, 3 groups, 4 images, 1 attached file and 8 to-dos");
    expect(describeCounts(counts({ todos: 1 }))).toBe("12 notes, 3 groups, 4 images, 1 attached file and 1 to-do");
  });

  it("still mentions the archive when nothing is live", () => {
    expect(describeCounts(counts({ archivedTodos: 31 }))).toBe(
      "12 notes, 3 groups, 4 images, 1 attached file and 0 to-dos (31 archived)",
    );
  });

  it("adds the contacts, in the singular for one", () => {
    expect(describeCounts(counts({ contacts: 40 }))).toBe("12 notes, 3 groups, 4 images, 1 attached file and 40 contacts");
    expect(describeCounts(counts({ todos: 8, contacts: 1 }))).toBe("12 notes, 3 groups, 4 images, 1 attached file, 8 to-dos and 1 contact");
  });

  it("puts what the Trash Can holds last", () => {
    expect(describeCounts(counts({ todos: 2, archivedTodos: 1, trashedNotes: 1, trashedGroups: 2 }))).toBe(
      "12 notes, 3 groups, 4 images, 1 attached file and 2 to-dos (1 archived), plus 3 items in the Trash Can",
    );
  });
});
