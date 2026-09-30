import { describe, expect, it } from "vitest";
import { buildGroupListing, groupPath } from "./groupListing";
import type { Group, Note } from "./types";

const group = (id: number, name: string, parentId: number | null = null): Group => ({
  id,
  name,
  parentId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const note = (id: number, groupId: number | null): Note => ({
  id,
  title: `Note ${id}`,
  content: "",
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId,
});

const groups = [group(1, "Docs"), group(2, "API", 1), group(3, "Auth", 2), group(4, "Other")];
const notes = [note(10, 1), note(11, 2), note(12, 3), note(13, 3), note(14, 4), note(15, null)];

describe("buildGroupListing", () => {
  it("nests sub-groups and their notes under the group", () => {
    const listing = buildGroupListing(1, groups, notes)!;

    expect(listing.notes.map((n) => n.id)).toEqual([10]);
    expect(listing.subgroups.map((s) => s.group.name)).toEqual(["API"]);
    expect(listing.subgroups[0].notes.map((n) => n.id)).toEqual([11]);
    expect(listing.subgroups[0].subgroups[0].notes.map((n) => n.id)).toEqual([12, 13]);
  });

  it("counts notes across the whole subtree", () => {
    const listing = buildGroupListing(1, groups, notes)!;

    expect(listing.totalNotes).toBe(4);
    expect(listing.subgroups[0].totalNotes).toBe(3);
  });

  it("excludes other groups and ungrouped notes", () => {
    const ids = JSON.stringify(buildGroupListing(1, groups, notes));

    expect(ids).not.toContain('"id":14');
    expect(ids).not.toContain('"id":15');
  });

  it("returns null for an unknown group", () => {
    expect(buildGroupListing(99, groups, notes)).toBeNull();
  });

  it("returns an empty listing for an empty group", () => {
    const listing = buildGroupListing(4, [group(4, "Empty")], [])!;

    expect(listing).toMatchObject({ subgroups: [], notes: [], totalNotes: 0 });
  });

  it("does not loop forever on a parent cycle", () => {
    const cyclic = [group(1, "A", 2), group(2, "B", 1)];

    expect(buildGroupListing(1, cyclic, [])!.subgroups[0].subgroups).toEqual([]);
  });
});

describe("groupPath", () => {
  it("lists ancestors from the top level down to the group", () => {
    expect(groupPath(3, groups).map((g) => g.name)).toEqual(["Docs", "API", "Auth"]);
  });

  it("is just the group for a top-level group", () => {
    expect(groupPath(4, groups).map((g) => g.name)).toEqual(["Other"]);
  });
});
