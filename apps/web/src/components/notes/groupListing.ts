import type { Group, Note } from "./types";

export type GroupListing = {
  group: Group;
  subgroups: GroupListing[];
  notes: Note[];
  /** Notes in this group and every group beneath it. */
  totalNotes: number;
};

/**
 * The full subtree under `groupId`: each group's sub-groups (in the order
 * `groups` lists them) and direct notes (in the order `notes` lists them).
 * Returns null when the group doesn't exist.
 */
export function buildGroupListing(
  groupId: number,
  groups: Group[],
  notes: Note[],
): GroupListing | null {
  const root = groups.find((g) => g.id === groupId);
  if (!root) return null;

  const visited = new Set<number>();

  function build(group: Group): GroupListing {
    visited.add(group.id);
    const subgroups = groups
      .filter((g) => g.parentId === group.id && !visited.has(g.id))
      .map(build);
    const own = notes.filter((n) => n.groupId === group.id);
    const totalNotes = own.length + subgroups.reduce((sum, s) => sum + s.totalNotes, 0);
    return { group, subgroups, notes: own, totalNotes };
  }

  return build(root);
}

/** Ancestors of a group from the top level down to (and including) the group. */
export function groupPath(groupId: number, groups: Group[]): Group[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const path: Group[] = [];
  const seen = new Set<number>();
  let current = byId.get(groupId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path;
}
