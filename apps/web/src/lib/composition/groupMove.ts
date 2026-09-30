type GroupLike = { id: number; parentId: number | null };

/**
 * Whether making `newParentId` the parent of group `id` would create a loop:
 * a group cannot become its own parent or sit beneath one of its descendants.
 * Pure (no DB) so the server action and the drag-and-drop UI share one rule.
 */
export function wouldCreateCycle(
  groups: GroupLike[],
  id: number,
  newParentId: number | null,
): boolean {
  const parentOf = new Map(groups.map((g) => [g.id, g.parentId]));
  const seen = new Set<number>();
  let cursor: number | null = newParentId;
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === id) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** Whether dropping group `id` onto `newParentId` would actually change anything. */
export function canMoveGroup(
  groups: GroupLike[],
  id: number,
  newParentId: number | null,
): boolean {
  const group = groups.find((g) => g.id === id);
  if (!group || group.parentId === newParentId) return false;
  return !wouldCreateCycle(groups, id, newParentId);
}
