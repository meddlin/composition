/**
 * Manual ordering of siblings (the notes in one group, the sub-groups of one group).
 * Pure so the repos (which persist the result) and the drag-and-drop UI (which shows
 * it before the server answers) share one rule.
 */

/**
 * `ids` (a sibling list in display order) with `id` placed immediately before `beforeId`,
 * or last when `beforeId` is null or no longer among the siblings. `id` may or may not
 * already be in the list: a move from another group adds it. Dropping `id` before itself
 * leaves it where it is.
 */
export function placeBefore(ids: number[], id: number, beforeId: number | null): number[] {
  const rest = ids.filter((existing) => existing !== id);
  if (beforeId === id) return ids.includes(id) ? ids : [...rest, id];
  const at = beforeId === null ? -1 : rest.indexOf(beforeId);
  return at === -1 ? [...rest, id] : [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * `items` with those named in `orderedIds` rearranged into that order, each taking a
 * slot an ordered item already held. Everything else keeps its place, so a list kept
 * in one array (all the notes) is reordered without disturbing the other siblings.
 */
export function applyOrder<T extends { id: number }>(items: T[], orderedIds: number[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = new Set(orderedIds);
  let next = 0;
  return items.map((item) => (ordered.has(item.id) ? byId.get(orderedIds[next++])! : item));
}
