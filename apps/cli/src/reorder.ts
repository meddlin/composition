import type { Group, Note } from "./backend";
import type { TreeRow } from "./tree";

/**
 * Where to put a note or group to move it one place up or down among its siblings, as the
 * arguments `placeNote` and `placeGroup` take: the item goes immediately before `beforeId`,
 * or last when that is null. Pure, so the rule can be tested without a screen.
 */
export type Placement =
  | { type: "note"; id: number; groupId: number | null; beforeId: number | null }
  | { type: "group"; id: number; parentId: number | null; beforeId: number | null };

export type Direction = "up" | "down";

/**
 * `notes` and `groups` must be in the order the data layer lists them (hand-placed first), which
 * is the order the tree shows. Returns null when the row can't move that way: the first or last
 * of its siblings, a favorites shortcut, the Ungrouped bucket, or anything that isn't a note or group.
 */
export function placementFor(
  row: TreeRow | undefined,
  direction: Direction,
  notes: readonly Note[],
  groups: readonly Group[],
): Placement | null {
  if (!row || ("favorite" in row && row.favorite)) return null;

  if (row.kind === "note") {
    const moving = notes.find((n) => n.id === row.noteId);
    if (!moving) return null;
    const ids = notes.filter((n) => n.groupId === moving.groupId).map((n) => n.id);
    const beforeId = beforeFor(ids, moving.id, direction);
    return beforeId === undefined ? null : { type: "note", id: moving.id, groupId: moving.groupId, beforeId };
  }

  if (row.kind === "group" && row.groupId !== null) {
    const moving = groups.find((g) => g.id === row.groupId);
    if (!moving) return null;
    const ids = groups.filter((g) => g.parentId === moving.parentId).map((g) => g.id);
    const beforeId = beforeFor(ids, moving.id, direction);
    return beforeId === undefined ? null : { type: "group", id: moving.id, parentId: moving.parentId, beforeId };
  }

  return null;
}

/** The sibling to place `id` before, null for last, or undefined when it is already at that end. */
function beforeFor(ids: number[], id: number, direction: Direction): number | null | undefined {
  const at = ids.indexOf(id);
  if (at === -1) return undefined;
  if (direction === "up") return at === 0 ? undefined : ids[at - 1];
  return at === ids.length - 1 ? undefined : (ids[at + 2] ?? null);
}
