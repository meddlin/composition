/** Where on a row a drag is hovering: above it, onto it, or below it. */
export type DropEdge = "before" | "into" | "after";

/** The share of a row's height, at each end, that counts as its edge when it can also be dropped onto. */
const EDGE_BAND = 0.25;

/**
 * Which edge of a row the pointer is on, given the edges the drag may use there;
 * null when it may use none. A row that can be dropped onto keeps its middle for that
 * and gives only the outer bands to `before`/`after`; one that can only be placed
 * beside (a note) splits down the middle.
 */
export function dropEdge(
  offsetY: number,
  height: number,
  allowed: readonly DropEdge[],
): DropEdge | null {
  if (allowed.includes("into")) {
    if (offsetY < height * EDGE_BAND && allowed.includes("before")) return "before";
    if (offsetY > height * (1 - EDGE_BAND) && allowed.includes("after")) return "after";
    return "into";
  }
  const preferred: DropEdge = offsetY < height / 2 ? "before" : "after";
  if (allowed.includes(preferred)) return preferred;
  return allowed.find((edge) => edge === "before" || edge === "after") ?? null;
}
