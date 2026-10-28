/**
 * How the panels of one window are arranged: a tree of rows and columns, in the way an editor's split view is.
 * A node is a panel or a split of two or more nodes, and every child of a split has a relative size, so the
 * children share the split's room in proportion to their sizes.
 *
 * Only the arrangement lives here. What a panel shows (its kind and state) is kept by the workspace store, under
 * the panel's id, and the functions here never make ids: callers pass them in.
 */

export type PanelId = string;

/** "row" puts the children side by side; "column" stacks them. */
export type Direction = "row" | "column";

export type SplitChild = { size: number; node: LayoutNode };

export type LayoutNode =
  | { type: "panel"; id: PanelId }
  | { type: "split"; direction: Direction; children: SplitChild[] };

/** The side of a panel that something is put beside. */
export type Edge = "left" | "right" | "top" | "bottom";

/** Where on a panel something was dropped: beside it on a given side, or onto it. */
export type DropZone = Edge | "center";

/** Every panel in the tree, left to right and top to bottom. */
export function panelIds(tree: LayoutNode): PanelId[] {
  return tree.type === "panel" ? [tree.id] : tree.children.flatMap((child) => panelIds(child.node));
}

/** A new panel on the right or left sits in a row; above or below, in a column. */
function directionOf(edge: Edge): Direction {
  return edge === "left" || edge === "right" ? "row" : "column";
}

/**
 * The tree in its simplest form: a split of one child is that child, and a split directly inside one that runs the
 * same way is merged into it, its children sharing the room it had in their own proportion. Closing a panel can
 * leave either behind.
 */
function tidy(node: LayoutNode): LayoutNode {
  if (node.type === "panel") return node;

  const children: SplitChild[] = [];
  for (const child of node.children) {
    const inner = tidy(child.node);
    if (inner.type === "split" && inner.direction === node.direction) {
      const total = inner.children.reduce((sum, grandchild) => sum + grandchild.size, 0);
      for (const grandchild of inner.children) {
        children.push({ size: (grandchild.size / total) * child.size, node: grandchild.node });
      }
    } else {
      children.push({ size: child.size, node: inner });
    }
  }
  return children.length === 1 ? children[0].node : { ...node, children };
}

/**
 * Closes a panel; its share goes to the panel after it (or before it, for the last in its split). Null when it
 * was the only panel, since an empty tree is for the caller to make sense of.
 */
export function closePanel(tree: LayoutNode, id: PanelId): LayoutNode | null {
  function remove(node: LayoutNode): LayoutNode | null {
    if (node.type === "panel") return node.id === id ? null : node;

    const at = node.children.findIndex((child) => child.node.type === "panel" && child.node.id === id);
    if (at === -1) {
      const children = node.children.map((child) => ({ ...child, node: remove(child.node)! }));
      return children.every((child, i) => child.node === node.children[i].node) ? node : { ...node, children };
    }

    const closed = node.children[at];
    const children = node.children.filter((_, i) => i !== at);
    if (children.length === 0) return null;
    const neighbour = at < children.length ? at : at - 1;
    children[neighbour] = { ...children[neighbour], size: children[neighbour].size + closed.size };
    return { ...node, children };
  }

  const next = remove(tree);
  return next === tree || next === null ? next : tidy(next);
}

/** Puts a new panel `newId` beside the panel `targetId`, on the given side of it. */
export function splitPanel(tree: LayoutNode, targetId: PanelId, edge: Edge, newId: PanelId): LayoutNode {
  const direction = directionOf(edge);
  const first = edge === "left" || edge === "top";
  const added: LayoutNode = { type: "panel", id: newId };

  function visit(node: LayoutNode): LayoutNode {
    if (node.type === "panel") {
      if (node.id !== targetId) return node;
      const children = [{ size: 1, node }, { size: 1, node: added }];
      return { type: "split", direction, children: first ? children.reverse() : children };
    }

    // In a split that already runs this way the new panel joins it, rather than nesting a split of two.
    const at = node.children.findIndex((child) => child.node.type === "panel" && child.node.id === targetId);
    if (at !== -1 && node.direction === direction) {
      const half = node.children[at].size / 2;
      const children = node.children.map((child, i) => (i === at ? { ...child, size: half } : child));
      children.splice(first ? at : at + 1, 0, { size: half, node: added });
      return { ...node, children };
    }
    return { ...node, children: node.children.map((child) => ({ ...child, node: visit(child.node) })) };
  }
  return visit(tree);
}

/**
 * Moves a panel to where it was dropped on `targetId`: beside it, taking half of its room (the room the panel leaves
 * goes to its neighbour), or onto it, where the two trade places and each place keeps its share.
 */
export function movePanel(tree: LayoutNode, id: PanelId, targetId: PanelId, zone: DropZone): LayoutNode {
  const ids = panelIds(tree);
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return tree;

  if (zone === "center") {
    const swapped = (node: LayoutNode): LayoutNode => {
      if (node.type === "panel") return node.id === id ? { ...node, id: targetId } : node.id === targetId ? { ...node, id } : node;
      return { ...node, children: node.children.map((child) => ({ ...child, node: swapped(child.node) })) };
    };
    return swapped(tree);
  }
  return splitPanel(closePanel(tree, id)!, targetId, zone, id);
}

/** The share of a panel's width or height, from each side, that counts as dropping beside it. */
const EDGE_FRACTION = 0.3;

/**
 * Which part of a panel (its `rect` on screen) the pointer is over: the side it is nearest, if it is within
 * `EDGE_FRACTION` of it, otherwise the middle. In a corner the nearer side, as a share of its length, wins.
 */
export function dropZoneAt(
  point: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): DropZone {
  if (!(rect.width > 0) || !(rect.height > 0)) return "center";

  const fromLeft = (point.x - rect.left) / rect.width;
  const fromTop = (point.y - rect.top) / rect.height;
  const sides: [Edge, number][] = [
    ["left", fromLeft],
    ["right", 1 - fromLeft],
    ["top", fromTop],
    ["bottom", 1 - fromTop],
  ];
  const [edge, share] = sides.reduce((nearest, side) => (side[1] < nearest[1] ? side : nearest));
  return share < EDGE_FRACTION ? edge : "center";
}

/**
 * The sizes after dragging the divider between children `index` and `index + 1` by `dxPx`, measured from where
 * `sizes` were when the drag began. Only those two trade room, and neither shrinks below its own minimum in
 * `minsPx` (one per child). `extentPx` is the room all the children share along the split. Unchanged when it has
 * no measurable width or there is no such divider.
 */
export function dragSizes(sizes: number[], index: number, dxPx: number, extentPx: number, minsPx: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!(extentPx > 0) || !(total > 0) || index < 0 || index >= sizes.length - 1) return sizes;

  const pxPerUnit = extentPx / total;
  const pair = sizes[index] + sizes[index + 1];
  let minBefore = minsPx[index] / pxPerUnit;
  let minAfter = minsPx[index + 1] / pxPerUnit;
  // Two children that can't both fit their minimum just split the pair evenly.
  if (minBefore + minAfter > pair) minBefore = minAfter = pair / 2;

  const before = Math.min(pair - minAfter, Math.max(minBefore, sizes[index] + dxPx / pxPerUnit));
  return sizes.map((size, i) => (i === index ? before : i === index + 1 ? pair - before : size));
}

/** Where a split is in the tree: the position of the child to step into, from the root down. Empty for the root. */
export type SplitPath = number[];

/** Applies sizes from a divider drag to the split at `path`; ignored if the path or the number of sizes doesn't fit. */
export function withSizes(tree: LayoutNode, path: SplitPath, sizes: number[]): LayoutNode {
  if (tree.type === "panel") return tree;

  if (path.length === 0) {
    return sizes.length === tree.children.length
      ? { ...tree, children: tree.children.map((child, i) => ({ ...child, size: sizes[i] })) }
      : tree;
  }

  const [at, ...rest] = path;
  const child = tree.children[at];
  if (!child) return tree;
  const node = withSizes(child.node, rest, sizes);
  return node === child.node ? tree : { ...tree, children: tree.children.map((c, i) => (i === at ? { ...c, node } : c)) };
}

/**
 * The least room, in px, a node needs along `axis` ("row" for width, "column" for height) when each panel needs
 * `leafMin(id, axis)`: children that sit along the axis add up, and ones that sit across it need only the largest.
 */
export function minExtent(node: LayoutNode, axis: Direction, leafMin: (id: PanelId, axis: Direction) => number): number {
  if (node.type === "panel") return leafMin(node.id, axis);
  const extents = node.children.map((child) => minExtent(child.node, axis, leafMin));
  return node.direction === axis ? extents.reduce((sum, extent) => sum + extent, 0) : Math.max(...extents);
}

/** Deeper than anything the app makes; a saved layout nested further is damaged, and reading it could run away. */
const MAX_DEPTH = 32;

/**
 * Reads a layout back from what was saved (any JSON value), keeping only what it knows. Null when it isn't a layout,
 * or has a panel id twice, so the caller can start again with one panel instead of showing a broken arrangement.
 * Whether the panels' kinds and notes still exist is not for this module to say.
 */
export function restoreLayout(saved: unknown): LayoutNode | null {
  const seen = new Set<PanelId>();

  function read(value: unknown, depth: number): LayoutNode | null {
    if (depth > MAX_DEPTH || typeof value !== "object" || value === null) return null;
    const entry = value as Record<string, unknown>;

    if (entry.type === "panel") {
      if (typeof entry.id !== "string" || entry.id === "" || seen.has(entry.id)) return null;
      seen.add(entry.id);
      return { type: "panel", id: entry.id };
    }

    const { direction, children: savedChildren } = entry;
    if (entry.type !== "split" || (direction !== "row" && direction !== "column")) return null;
    if (!Array.isArray(savedChildren) || savedChildren.length === 0) return null;

    const children: SplitChild[] = [];
    for (const savedChild of savedChildren) {
      if (typeof savedChild !== "object" || savedChild === null) return null;
      const { size, node: savedNode } = savedChild as Record<string, unknown>;
      if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
      const node = read(savedNode, depth + 1);
      if (!node) return null;
      children.push({ size, node });
    }
    return { type: "split", direction, children };
  }

  const tree = read(saved, 0);
  return tree && tidy(tree);
}
