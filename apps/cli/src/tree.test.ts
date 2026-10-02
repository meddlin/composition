import { describe, expect, it } from "vitest";
import type { Group, Note } from "./backend";
import { buildTree, groupKey, noteKey, orderedGroups, pruneFavorites, targetGroupId, type TreeRow } from "./tree";

const stamp = "2026-01-01T00:00:00.000Z";
const note = (id: number, title: string, groupId: number | null = null): Note => ({
  id,
  title,
  content: "",
  tags: "",
  description: "",
  createdAt: stamp,
  updatedAt: stamp,
  groupId,
});
const group = (id: number, name: string, parentId: number | null = null): Group => ({
  id,
  name,
  parentId,
  createdAt: stamp,
  updatedAt: stamp,
});

const labels = (rows: TreeRow[]) => rows.map((r) => `${"  ".repeat(r.depth)}${r.label}`);
const none = new Set<string>();

describe("buildTree", () => {
  it("lists groups by name, each with its sub-groups first and then its own notes", () => {
    const rows = buildTree({
      groups: [group(2, "Work"), group(1, "Home"), group(3, "Projects", 2)],
      notes: [note(1, "Taxes", 1), note(2, "Plan", 3), note(3, "Standup", 2)],
      collapsed: none,
    });

    expect(labels(rows)).toEqual([
      "Home",
      "  Taxes",
      "Work",
      "  Projects",
      "    Plan",
      "  Standup",
      "⌫ Trash", "⚙ Settings",
    ]);
  });

  it("puts ungrouped notes in an Ungrouped bucket after the groups", () => {
    const rows = buildTree({
      groups: [group(1, "Home")],
      notes: [note(1, "Loose"), note(2, "Taxes", 1)],
      collapsed: none,
    });

    expect(labels(rows)).toEqual(["Home", "  Taxes", "Ungrouped", "  Loose", "⌫ Trash", "⚙ Settings"]);
  });

  it("omits the Ungrouped bucket when it would be empty and groups exist", () => {
    const rows = buildTree({ groups: [group(1, "Home")], notes: [note(1, "Taxes", 1)], collapsed: none });

    expect(labels(rows)).not.toContain("Ungrouped");
  });

  it("shows an empty Ungrouped bucket when there are no groups at all", () => {
    expect(labels(buildTree({ groups: [], notes: [], collapsed: none }))).toEqual([
      "Ungrouped",
      "⌫ Trash", "⚙ Settings",
    ]);
  });

  it("keeps the order notes arrive in (most recently edited first)", () => {
    const rows = buildTree({ groups: [], notes: [note(2, "Newer"), note(1, "Older")], collapsed: none });

    expect(labels(rows).slice(1, 3)).toEqual(["  Newer", "  Older"]);
  });

  it("hides everything under a collapsed group and marks it collapsed", () => {
    const rows = buildTree({
      groups: [group(1, "Work"), group(2, "Projects", 1)],
      notes: [note(1, "Plan", 2), note(2, "Standup", 1)],
      collapsed: new Set([groupKey(1)]),
    });

    expect(labels(rows)).toEqual(["Work", "⌫ Trash", "⚙ Settings"]);
    expect(rows[0]).toMatchObject({ kind: "group", groupId: 1, expanded: false });
  });

  it("can collapse the Ungrouped bucket", () => {
    const rows = buildTree({ groups: [], notes: [note(1, "Loose")], collapsed: new Set([groupKey(null)]) });

    expect(labels(rows)).toEqual(["Ungrouped", "⌫ Trash", "⚙ Settings"]);
  });

  it("gives every row a stable key", () => {
    const rows = buildTree({ groups: [group(1, "Work")], notes: [note(7, "Plan", 1)], collapsed: none });

    expect(rows.map((r) => r.key)).toEqual([groupKey(1), noteKey(7), "trash", "settings"]);
  });

  describe("while a search is filtering the notes", () => {
    it("drops groups that have no matching note anywhere below them", () => {
      const rows = buildTree({
        groups: [group(1, "Home"), group(2, "Work"), group(3, "Projects", 2)],
        notes: [note(2, "Plan", 3)],
        collapsed: none,
        filtering: true,
      });

      expect(labels(rows)).toEqual(["Work", "  Projects", "    Plan", "⌫ Trash", "⚙ Settings"]);
    });

    it("says nothing matched instead of showing an empty Ungrouped bucket", () => {
      const rows = buildTree({ groups: [group(1, "Home")], notes: [], collapsed: none, filtering: true });

      expect(labels(rows)).toEqual(["No notes match.", "⌫ Trash", "⚙ Settings"]);
      expect(rows[0].kind).toBe("message");
    });
  });
});

describe("favorites", () => {
  const all = {
    groups: [group(1, "Work")],
    notes: [note(1, "Plan", 1), note(2, "Loose")],
    collapsed: none,
  };

  it("lists pinned notes and groups above the tree, in the order they were pinned", () => {
    const rows = buildTree({
      ...all,
      favorites: [
        { type: "note", id: 2 },
        { type: "group", id: 1 },
        { type: "note", id: 1 },
      ],
    });

    expect(labels(rows).slice(0, 4)).toEqual(["★ Favorites", "  Loose", "  Work", "  Plan"]);
    expect(rows[0]).toMatchObject({ kind: "section", key: "favorites", expanded: true });
    expect(rows.slice(1, 4).every((r) => "favorite" in r && r.favorite)).toBe(true);
  });

  it("gives a favorite its own row key, so the same note can sit in both places", () => {
    const rows = buildTree({ ...all, favorites: [{ type: "note", id: 1 }] });

    const keys = rows.map((r) => r.key);
    expect(keys).toContain("fav:note:1");
    expect(keys).toContain(noteKey(1));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks pinned notes and groups where they sit in the tree", () => {
    const rows = buildTree({ ...all, favorites: [{ type: "note", id: 1 }, { type: "group", id: 1 }] });

    const main = (key: string) => rows.find((r) => r.key === key);
    expect(main(noteKey(1))).toMatchObject({ pinned: true });
    expect(main(groupKey(1))).toMatchObject({ pinned: true });
    expect(main(noteKey(2))).toMatchObject({ pinned: false });
  });

  it("hides the entries when the section is collapsed, but not the section", () => {
    const rows = buildTree({ ...all, favorites: [{ type: "note", id: 1 }], collapsed: new Set(["favorites"]) });

    expect(labels(rows).slice(0, 2)).toEqual(["★ Favorites", "Work"]);
    expect(rows[0]).toMatchObject({ expanded: false });
  });

  it("shows no section when nothing is pinned", () => {
    expect(labels(buildTree({ ...all, favorites: [] }))).not.toContain("★ Favorites");
  });

  it("skips a favorite whose note or group has since been deleted", () => {
    const rows = buildTree({ ...all, favorites: [{ type: "note", id: 99 }, { type: "group", id: 98 }] });

    expect(labels(rows)).not.toContain("★ Favorites");
  });

  it("leaves the section out while a search is filtering the tree", () => {
    const rows = buildTree({ ...all, favorites: [{ type: "note", id: 1 }], filtering: true });

    expect(labels(rows)).not.toContain("★ Favorites");
  });

  it("uses the note's current title", () => {
    const rows = buildTree({ ...all, notes: [note(1, "Renamed", 1)], favorites: [{ type: "note", id: 1 }] });

    expect(labels(rows)).toContain("  Renamed");
  });
});

describe("pruneFavorites", () => {
  it("drops favorites whose note or group no longer exists, keeping the order", () => {
    const pruned = pruneFavorites(
      [{ type: "note", id: 1 }, { type: "note", id: 99 }, { type: "group", id: 1 }, { type: "group", id: 98 }],
      [note(1, "Plan")],
      [group(1, "Work")],
    );

    expect(pruned).toEqual([{ type: "note", id: 1 }, { type: "group", id: 1 }]);
  });
});

describe("targetGroupId", () => {
  const notesById = new Map([[7, note(7, "Plan", 3)], [8, note(8, "Loose")]]);
  const rows = buildTree({
    groups: [group(3, "Projects")],
    notes: [...notesById.values()],
    collapsed: none,
  });
  const at = (key: string) => rows.find((r) => r.key === key);

  it("is a highlighted group's own id", () => {
    expect(targetGroupId(at(groupKey(3)), notesById)).toBe(3);
  });

  it("is the group a highlighted note already belongs to", () => {
    expect(targetGroupId(at(noteKey(7)), notesById)).toBe(3);
  });

  it("is nothing for an ungrouped note, the Ungrouped bucket, Settings, or no row", () => {
    expect(targetGroupId(at(noteKey(8)), notesById)).toBeNull();
    expect(targetGroupId(at(groupKey(null)), notesById)).toBeNull();
    expect(targetGroupId(at("settings"), notesById)).toBeNull();
    expect(targetGroupId(at("trash"), notesById)).toBeNull();
    expect(targetGroupId(undefined, notesById)).toBeNull();
  });
});

describe("orderedGroups", () => {
  it("lists parents before children, siblings by name, with depth", () => {
    const ordered = orderedGroups([group(3, "Projects", 2), group(2, "Work"), group(1, "Home"), group(4, "Archive", 3)]);

    expect(ordered.map(({ group: g, depth }) => [g.name, depth])).toEqual([
      ["Home", 0],
      ["Work", 0],
      ["Projects", 1],
      ["Archive", 2],
    ]);
  });

  it("is empty with no groups", () => {
    expect(orderedGroups([])).toEqual([]);
  });
});
