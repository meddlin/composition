import { describe, expect, it } from "vitest";
import { closePanel, dragSizes, dropZoneAt, minExtent, movePanel, panelIds, restoreLayout, splitPanel, withSizes, type Direction, type LayoutNode } from "./layoutTree";

const leaf = (id: string): LayoutNode => ({ type: "panel", id });

/** A split written out by hand, children left to right (or top to bottom) as `[size, node]`. */
const split = (direction: Direction, ...children: [number, LayoutNode][]): LayoutNode => ({
  type: "split",
  direction,
  children: children.map(([size, node]) => ({ size, node })),
});

describe("splitPanel", () => {
  it("puts the new panel to the right of a lone panel, sharing the space equally", () => {
    expect(splitPanel(leaf("a"), "a", "right", "b")).toEqual(split("row", [1, leaf("a")], [1, leaf("b")]));
  });

  it("joins the row it is split in, taking half of the panel's share", () => {
    const tree = split("row", [2, leaf("a")], [1, leaf("b")]);

    expect(splitPanel(tree, "a", "right", "c")).toEqual(split("row", [1, leaf("a")], [1, leaf("c")], [1, leaf("b")]));
    expect(splitPanel(tree, "b", "left", "c")).toEqual(split("row", [2, leaf("a")], [0.5, leaf("c")], [0.5, leaf("b")]));
  });
});

describe("splitPanel across a split", () => {
  it("nests a column in the panel's place when split above or below a panel in a row", () => {
    const tree = split("row", [2, leaf("a")], [1, leaf("b")]);

    expect(splitPanel(tree, "a", "bottom", "c")).toEqual(
      split("row", [2, split("column", [1, leaf("a")], [1, leaf("c")])], [1, leaf("b")]),
    );
    expect(splitPanel(tree, "b", "top", "c")).toEqual(
      split("row", [2, leaf("a")], [1, split("column", [1, leaf("c")], [1, leaf("b")])]),
    );
  });

  it("finds a panel deep in the tree, and leaves the tree alone when it is not there", () => {
    const tree = split("row", [1, leaf("a")], [1, split("column", [1, leaf("b")], [1, leaf("c")])]);

    expect(splitPanel(tree, "c", "bottom", "d")).toEqual(
      split("row", [1, leaf("a")], [1, split("column", [1, leaf("b")], [0.5, leaf("c")], [0.5, leaf("d")])]),
    );
    expect(splitPanel(tree, "zzz", "right", "d")).toEqual(tree);
  });
});

describe("closePanel", () => {
  it("gives the closed panel's share to the panel after it, or before it for the last", () => {
    const tree = split("row", [1, leaf("a")], [2, leaf("b")], [1, leaf("c")]);

    expect(closePanel(tree, "b")).toEqual(split("row", [1, leaf("a")], [3, leaf("c")]));
    expect(closePanel(tree, "c")).toEqual(split("row", [1, leaf("a")], [3, leaf("b")]));
  });

  it("returns the same tree for a panel that is not in it", () => {
    const tree = split("row", [1, leaf("a")], [1, leaf("b")]);

    expect(closePanel(tree, "zzz")).toBe(tree);
  });

  it("returns null when the last panel is closed, for the caller to decide what an empty window means", () => {
    expect(closePanel(leaf("a"), "a")).toBeNull();
  });

  it("replaces a split left with one child by that child, which keeps the split's place and share", () => {
    const tree = split("row", [2, leaf("a")], [1, split("column", [1, leaf("b")], [1, leaf("c")])]);

    expect(closePanel(tree, "c")).toEqual(split("row", [2, leaf("a")], [1, leaf("b")]));
  });

  it("merges a split into the one around it when they come to run the same way", () => {
    // Closing b leaves the column holding only the row of c and d, which now sits in a row.
    const tree = split(
      "row",
      [1, leaf("a")],
      [2, split("column", [1, leaf("b")], [1, split("row", [1, leaf("c")], [3, leaf("d")])])],
    );

    // c and d share the 2 the column had, in their own proportion.
    expect(closePanel(tree, "b")).toEqual(split("row", [1, leaf("a")], [0.5, leaf("c")], [1.5, leaf("d")]));
  });

  it("collapses all the way up when a whole branch empties", () => {
    const tree = split("row", [1, split("column", [1, leaf("a")], [1, leaf("b")])], [1, leaf("c")]);

    expect(closePanel(closePanel(tree, "a")!, "b")).toEqual(leaf("c"));
  });
});

describe("movePanel", () => {
  const row3 = split("row", [1, leaf("a")], [1, leaf("b")], [1, leaf("c")]);

  it("reorders a panel within its row when dropped beside a sibling", () => {
    expect(movePanel(row3, "a", "b", "right")).toEqual(split("row", [1, leaf("b")], [1, leaf("a")], [1, leaf("c")]));
  });

  it("hands the room it leaves to its neighbour and takes half of the target's", () => {
    expect(movePanel(row3, "a", "c", "right")).toEqual(
      split("row", [2, leaf("b")], [0.5, leaf("c")], [0.5, leaf("a")]),
    );
  });

  it("nests a column when dropped above or below a panel in a row", () => {
    expect(movePanel(row3, "c", "a", "top")).toEqual(
      split("row", [1, split("column", [1, leaf("c")], [1, leaf("a")])], [2, leaf("b")]),
    );
  });

  it("swaps two panels when dropped on the middle of one, each place keeping its share", () => {
    const tree = split("row", [2, leaf("a")], [1, leaf("b")]);

    expect(movePanel(tree, "a", "b", "center")).toEqual(split("row", [2, leaf("b")], [1, leaf("a")]));
  });

  it("leaves the tree alone when dropped on itself, or when either panel is not in it", () => {
    expect(movePanel(row3, "a", "a", "right")).toBe(row3);
    expect(movePanel(row3, "zzz", "a", "right")).toBe(row3);
    expect(movePanel(row3, "a", "zzz", "right")).toBe(row3);
  });
});

describe("panelIds", () => {
  it("lists the panels left to right and top to bottom", () => {
    const tree = split("row", [1, split("column", [1, leaf("a")], [1, leaf("b")])], [1, leaf("c")]);

    expect(panelIds(tree)).toEqual(["a", "b", "c"]);
  });
});

describe("dropZoneAt", () => {
  // 400 wide and 200 tall, so the outer 30% of each side is 120 and 60 px.
  const rect = { left: 100, top: 50, width: 400, height: 200 };

  it("tells which side of a panel the pointer is nearest, or the middle", () => {
    expect(dropZoneAt({ x: 110, y: 150 }, rect)).toBe("left");
    expect(dropZoneAt({ x: 490, y: 150 }, rect)).toBe("right");
    expect(dropZoneAt({ x: 300, y: 60 }, rect)).toBe("top");
    expect(dropZoneAt({ x: 300, y: 240 }, rect)).toBe("bottom");
    expect(dropZoneAt({ x: 300, y: 150 }, rect)).toBe("center");
  });

  it("goes by the nearer side in a corner", () => {
    expect(dropZoneAt({ x: 110, y: 70 }, rect)).toBe("left"); // 2.5% in from the left, 10% down from the top
    expect(dropZoneAt({ x: 140, y: 52 }, rect)).toBe("top"); // 10% in from the left, 1% down from the top
  });

  it("reads a panel with no size as the middle", () => {
    expect(dropZoneAt({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 })).toBe("center");
  });
});

describe("dragSizes", () => {
  it("trades room between the two children either side of the divider, in proportion to the pixels dragged", () => {
    // 400 px for 2 units: 200 px a unit, so 100 px is half a unit.
    expect(dragSizes([1, 1], 0, 100, 400, [0, 0])).toEqual([1.5, 0.5]);
    expect(dragSizes([1, 1], 0, -100, 400, [0, 0])).toEqual([0.5, 1.5]);
  });

  it("leaves the other children as they were", () => {
    expect(dragSizes([1, 1, 2], 1, 100, 800, [0, 0, 0])).toEqual([1, 1.5, 1.5]);
  });

  it("stops a child at its own minimum width", () => {
    // 600 px for 2 units is 300 px each; the right one may not go below 240 px (0.8 of a unit).
    expect(dragSizes([1, 1], 0, 500, 600, [240, 240])).toEqual([1.2, 0.8]);
    expect(dragSizes([1, 1], 0, -500, 600, [240, 240])).toEqual([0.8, 1.2]);
  });

  it("splits the pair evenly when both cannot have their minimum", () => {
    expect(dragSizes([1, 3], 0, 40, 400, [240, 240])).toEqual([2, 2]);
  });

  it("returns the sizes as they were for a row with no width, or a divider that is not there", () => {
    const sizes = [1, 1];
    expect(dragSizes(sizes, 0, 50, 0, [0, 0])).toBe(sizes);
    expect(dragSizes(sizes, 1, 50, 400, [0, 0])).toBe(sizes);
    expect(dragSizes(sizes, -1, 50, 400, [0, 0])).toBe(sizes);
  });
});

describe("withSizes", () => {
  const tree = split("row", [1, leaf("a")], [1, split("column", [1, leaf("b")], [1, leaf("c")])]);

  it("sets the sizes of the split at the end of a path of child positions", () => {
    expect(withSizes(tree, [], [3, 1])).toEqual(split("row", [3, leaf("a")], [1, split("column", [1, leaf("b")], [1, leaf("c")])]));
    expect(withSizes(tree, [1], [3, 1])).toEqual(split("row", [1, leaf("a")], [1, split("column", [3, leaf("b")], [1, leaf("c")])]));
  });

  it("returns the tree as it was when the path leads nowhere or the sizes do not fit the split", () => {
    expect(withSizes(tree, [0], [1, 1])).toBe(tree); // a panel, not a split
    expect(withSizes(tree, [5], [1, 1])).toBe(tree);
    expect(withSizes(tree, [], [1, 1, 1])).toBe(tree);
  });
});

describe("minExtent", () => {
  // A panel is at least 240 px wide and 120 px tall.
  const leafMin = (_id: string, axis: Direction) => (axis === "row" ? 240 : 120);
  const tree = split("row", [1, leaf("a")], [1, split("column", [1, leaf("b")], [1, leaf("c")])]);

  it("adds up along the way a split runs, and takes the largest across it", () => {
    expect(minExtent(tree, "row", leafMin)).toBe(480); // a, then the column's widest
    expect(minExtent(tree, "column", leafMin)).toBe(240); // b above c, against a alone
  });

  it("is a lone panel's own minimum", () => {
    expect(minExtent(leaf("a"), "row", leafMin)).toBe(240);
  });
});

describe("restoreLayout", () => {
  it("reads back a layout that was saved", () => {
    const saved = split("row", [2, leaf("a")], [1, split("column", [1, leaf("b")], [3, leaf("c")])]);

    expect(restoreLayout(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("drops anything it does not know, rather than keeping it", () => {
    expect(restoreLayout({ type: "panel", id: "a", junk: 1 })).toEqual(leaf("a"));
  });

  it("is null for anything that is not a layout, for the caller to start again from", () => {
    const bad: unknown[] = [
      undefined,
      null,
      "a",
      42,
      [],
      {},
      { type: "tabs" },
      { type: "panel" },
      { type: "panel", id: "" },
      { type: "panel", id: 7 },
      { type: "split", direction: "row", children: [] },
      { type: "split", direction: "diagonal", children: [{ size: 1, node: leaf("a") }, { size: 1, node: leaf("b") }] },
      { type: "split", direction: "row", children: "ab" },
      { type: "split", direction: "row", children: [{ size: 0, node: leaf("a") }, { size: 1, node: leaf("b") }] },
      { type: "split", direction: "row", children: [{ size: -1, node: leaf("a") }, { size: 1, node: leaf("b") }] },
      { type: "split", direction: "row", children: [{ size: Infinity, node: leaf("a") }, { size: 1, node: leaf("b") }] },
      { type: "split", direction: "row", children: [{ size: "1", node: leaf("a") }, { size: 1, node: leaf("b") }] },
      { type: "split", direction: "row", children: [{ size: 1 }, { size: 1, node: leaf("b") }] },
    ];

    for (const saved of bad) expect(restoreLayout(saved), JSON.stringify(saved)).toBeNull();
  });

  it("is null when a panel id is used twice, since each panel is in one place", () => {
    expect(restoreLayout(split("row", [1, leaf("a")], [1, leaf("a")]))).toBeNull();
  });

  it("is null for a tree nested too deeply to be anything the app made", () => {
    let deep: LayoutNode = leaf("p0");
    for (let i = 1; i <= 100; i++) deep = split(i % 2 ? "row" : "column", [1, leaf(`p${i}`)], [1, deep]);

    expect(restoreLayout(deep)).toBeNull();
  });

  it("tidies a layout that was saved untidy", () => {
    const untidy = split("row", [1, split("column", [1, leaf("a")])], [1, leaf("b")]);

    expect(restoreLayout(untidy)).toEqual(split("row", [1, leaf("a")], [1, leaf("b")]));
  });
});
