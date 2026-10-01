import { describe, expect, it } from "vitest";
import {
  closePane,
  dragPaneSizes,
  dropNote,
  dropZoneAt,
  focusPane,
  initialPanes,
  openNote,
  setPaneView,
  shownView,
  withSizes,
  type PaneState,
  type PaneView,
} from "./panes";

/** Panes of the given note ids, equal in size, focused on `focusedId`. */
function state(noteIds: number[], focusedId: number | null = noteIds[0] ?? null): PaneState {
  return { panes: noteIds.map((noteId) => ({ noteId, size: 1, view: "split" as const })), focusedId };
}

const ids = (s: PaneState) => s.panes.map((p) => p.noteId);
const viewOf = (s: PaneState, noteId: number) => s.panes.find((p) => p.noteId === noteId)?.view;

/** `state([1, 2, 3])` with each pane's view set, in order. */
function withViews(base: PaneState, ...views: PaneView[]): PaneState {
  return { ...base, panes: base.panes.map((p, i) => ({ ...p, view: views[i] })) };
}

describe("initialPanes", () => {
  it("opens the given note in one pane", () => {
    expect(initialPanes(4)).toEqual({ panes: [{ noteId: 4, size: 1, view: "split" }], focusedId: 4 });
  });

  it("starts empty without a note", () => {
    expect(initialPanes(null)).toEqual({ panes: [], focusedId: null });
  });
});

describe("setPaneView", () => {
  it("sets the view of one pane and leaves the others", () => {
    const next = setPaneView(state([1, 2]), 2, "preview");
    expect(viewOf(next, 2)).toBe("preview");
    expect(viewOf(next, 1)).toBe("split");
  });

  it("returns the same state when nothing changes or the note is not open", () => {
    const s = state([1, 2]);
    expect(setPaneView(s, 1, "split")).toBe(s);
    expect(setPaneView(s, 9, "preview")).toBe(s);
  });
});

describe("shownView", () => {
  it("shows the chosen view when there is room", () => {
    expect(shownView("split", true)).toBe("split");
    expect(shownView("markdown", true)).toBe("markdown");
    expect(shownView("preview", true)).toBe("preview");
  });

  it("falls back from side by side to the editor tab when there is no room", () => {
    expect(shownView("split", false)).toBe("markdown");
  });

  it("leaves a single-view choice alone however narrow the pane is", () => {
    expect(shownView("markdown", false)).toBe("markdown");
    expect(shownView("preview", false)).toBe("preview");
  });
});

describe("focusPane", () => {
  it("focuses an open pane", () => {
    expect(focusPane(state([1, 2]), 2).focusedId).toBe(2);
  });

  it("ignores a note that is not open, and returns the same state when nothing changes", () => {
    const s = state([1, 2]);
    expect(focusPane(s, 9)).toBe(s);
    expect(focusPane(s, 1)).toBe(s);
  });
});

describe("openNote", () => {
  it("replaces the note in the focused pane", () => {
    const next = openNote(state([1, 2], 2), 3);
    expect(ids(next)).toEqual([1, 3]);
    expect(next.focusedId).toBe(3);
  });

  it("keeps the view of the pane it replaces", () => {
    const s = withViews(state([1, 2], 1), "preview", "markdown");
    expect(viewOf(openNote(s, 5), 5)).toBe("preview");
  });

  it("keeps the size of the pane it replaces", () => {
    const s: PaneState = { panes: [{ noteId: 1, size: 3, view: "split" }, { noteId: 2, size: 1, view: "split" }], focusedId: 1 };
    expect(openNote(s, 5).panes[0]).toEqual({ noteId: 5, size: 3, view: "split" });
  });

  it("focuses the pane a note is already open in rather than duplicating it", () => {
    const next = openNote(state([1, 2], 1), 2);
    expect(ids(next)).toEqual([1, 2]);
    expect(next.focusedId).toBe(2);
  });

  it("opens the first pane when none is open", () => {
    expect(openNote(initialPanes(null), 6)).toEqual(initialPanes(6));
  });
});

describe("closePane", () => {
  it("hands the closed pane's width to the pane after it", () => {
    const next = closePane({ panes: [{ noteId: 1, size: 2, view: "split" }, { noteId: 2, size: 1, view: "split" }, { noteId: 3, size: 1, view: "split" }], focusedId: 1 }, 1);
    expect(next.panes).toEqual([{ noteId: 2, size: 3, view: "split" }, { noteId: 3, size: 1, view: "split" }]);
  });

  it("hands the last pane's width to the pane before it", () => {
    const next = closePane(state([1, 2, 3], 1), 3);
    expect(next.panes).toEqual([{ noteId: 1, size: 1, view: "split" }, { noteId: 2, size: 2, view: "split" }]);
  });

  it("moves focus to the neighbour when the focused pane closes", () => {
    expect(closePane(state([1, 2, 3], 2), 2).focusedId).toBe(3);
    expect(closePane(state([1, 2, 3], 3), 3).focusedId).toBe(2);
  });

  it("keeps focus where it was when another pane closes", () => {
    expect(closePane(state([1, 2, 3], 3), 1).focusedId).toBe(3);
  });

  it("leaves nothing focused when the last pane closes", () => {
    expect(closePane(state([1]), 1)).toEqual({ panes: [], focusedId: null });
  });

  it("ignores a note that is not open", () => {
    const s = state([1, 2]);
    expect(closePane(s, 9)).toBe(s);
  });
});

describe("dropNote beside a pane", () => {
  it("opens a new pane to the right, splitting the target's width", () => {
    const next = dropNote(state([1, 2]), 3, 1, "right");
    expect(next.panes).toEqual([
      { noteId: 1, size: 0.5, view: "split" },
      { noteId: 3, size: 0.5, view: "split" },
      { noteId: 2, size: 1, view: "split" },
    ]);
    expect(next.focusedId).toBe(3);
  });

  it("opens a new pane to the left", () => {
    expect(ids(dropNote(state([1, 2]), 3, 2, "left"))).toEqual([1, 3, 2]);
    expect(ids(dropNote(state([1, 2]), 3, 1, "left"))).toEqual([3, 1, 2]);
  });

  it("moves a note that is open elsewhere instead of duplicating it", () => {
    const next = dropNote(state([1, 2, 3]), 1, 3, "right");
    expect(ids(next)).toEqual([2, 3, 1]);
    expect(next.focusedId).toBe(1);
  });

  it("opens a new pane side by side, whatever the target pane shows", () => {
    const next = dropNote(withViews(state([1, 2]), "preview", "preview"), 3, 1, "right");
    expect(viewOf(next, 3)).toBe("split");
  });

  it("keeps a moved pane's view", () => {
    const next = dropNote(withViews(state([1, 2, 3]), "preview", "split", "markdown"), 1, 3, "right");
    expect(ids(next)).toEqual([2, 3, 1]);
    expect(viewOf(next, 1)).toBe("preview");
    expect(viewOf(next, 3)).toBe("markdown");
  });

  it("leaves every pane's width alone when moving one", () => {
    const s: PaneState = {
      panes: [{ noteId: 1, size: 1, view: "split" }, { noteId: 2, size: 2, view: "split" }, { noteId: 3, size: 4, view: "split" }],
      focusedId: 1,
    };
    expect(dropNote(s, 3, 1, "left").panes).toEqual([
      { noteId: 3, size: 4, view: "split" },
      { noteId: 1, size: 1, view: "split" },
      { noteId: 2, size: 2, view: "split" },
    ]);
    expect(dropNote(s, 1, 3, "right").panes).toEqual([
      { noteId: 2, size: 2, view: "split" },
      { noteId: 3, size: 4, view: "split" },
      { noteId: 1, size: 1, view: "split" },
    ]);
  });

  it("moves a pane to the other side of its neighbour", () => {
    expect(ids(dropNote(state([1, 2]), 1, 2, "right"))).toEqual([2, 1]);
    expect(ids(dropNote(state([1, 2]), 2, 1, "left"))).toEqual([2, 1]);
  });

  it("keeps the total width constant", () => {
    const total = (s: PaneState) => s.panes.reduce((sum, p) => sum + p.size, 0);
    const s = state([1, 2, 3]);
    expect(total(dropNote(s, 4, 2, "right"))).toBeCloseTo(total(s));
    expect(total(dropNote(s, 1, 3, "left"))).toBeCloseTo(total(s));
  });

  it("does nothing when a pane is dropped beside itself", () => {
    const next = dropNote(state([1, 2], 2), 1, 1, "right");
    expect(ids(next)).toEqual([1, 2]);
    expect(next.focusedId).toBe(1);
  });

  it("ignores a target that is not open", () => {
    const s = state([1]);
    expect(dropNote(s, 2, 9, "right")).toBe(s);
  });
});

describe("dropNote onto a pane", () => {
  it("replaces the target pane's note", () => {
    const next = dropNote(state([1, 2]), 3, 2, "center");
    expect(ids(next)).toEqual([1, 3]);
    expect(next.focusedId).toBe(3);
  });

  it("keeps the target pane's view when it is given a new note", () => {
    const next = dropNote(withViews(state([1, 2]), "split", "preview"), 3, 2, "center");
    expect(viewOf(next, 3)).toBe("preview");
  });

  it("sends each view along with its note when two panes swap", () => {
    const next = dropNote(withViews(state([1, 2]), "preview", "markdown"), 1, 2, "center");
    expect(ids(next)).toEqual([2, 1]);
    expect(viewOf(next, 1)).toBe("preview");
    expect(viewOf(next, 2)).toBe("markdown");
  });

  it("swaps places with a note that is open in another pane", () => {
    const s: PaneState = { panes: [{ noteId: 1, size: 3, view: "split" }, { noteId: 2, size: 1, view: "split" }], focusedId: 1 };
    const next = dropNote(s, 1, 2, "center");
    // Sizes belong to the positions, so only the notes trade.
    expect(next.panes).toEqual([{ noteId: 2, size: 3, view: "split" }, { noteId: 1, size: 1, view: "split" }]);
    expect(next.focusedId).toBe(1);
  });
});

describe("withSizes", () => {
  it("applies sizes by position", () => {
    expect(withSizes(state([1, 2]), [3, 1]).panes).toEqual([{ noteId: 1, size: 3, view: "split" }, { noteId: 2, size: 1, view: "split" }]);
  });

  it("keeps each pane's view", () => {
    expect(viewOf(withSizes(withViews(state([1, 2]), "preview", "markdown"), [3, 1]), 1)).toBe("preview");
  });

  it("ignores sizes for a different number of panes", () => {
    const s = state([1, 2]);
    expect(withSizes(s, [1, 1, 1])).toBe(s);
  });
});

describe("dragPaneSizes", () => {
  it("moves width between the two panes beside the divider", () => {
    // Two panes in 1000px: 100px is a tenth of the 2 units.
    expect(dragPaneSizes([1, 1], 0, 100, 1000)).toEqual([1.2, 0.8]);
    expect(dragPaneSizes([1, 1], 0, -100, 1000)).toEqual([0.8, 1.2]);
  });

  it("leaves the other panes alone", () => {
    const next = dragPaneSizes([1, 1, 2], 0, 100, 1000);
    expect(next[2]).toBe(2);
    expect(next[0] + next[1]).toBeCloseTo(2);
  });

  it("stops each pane at the minimum width", () => {
    // 1000px over 2 units: 240px is 0.48 units.
    const [left, right] = dragPaneSizes([1, 1], 0, 5000, 1000, 240);
    expect(right).toBeCloseTo(0.48);
    expect(left).toBeCloseTo(1.52);
    const [l2] = dragPaneSizes([1, 1], 0, -5000, 1000, 240);
    expect(l2).toBeCloseTo(0.48);
  });

  it("splits evenly when the pair is too narrow for two minimum-width panes", () => {
    expect(dragPaneSizes([1, 1], 0, 300, 400, 240)).toEqual([1, 1]);
  });

  it("is unchanged when the row has no width or the divider doesn't exist", () => {
    expect(dragPaneSizes([1, 1], 0, 100, 0)).toEqual([1, 1]);
    expect(dragPaneSizes([1, 1], 0, 100, NaN)).toEqual([1, 1]);
    expect(dragPaneSizes([1, 1], 1, 100, 1000)).toEqual([1, 1]);
    expect(dragPaneSizes([1, 1], -1, 100, 1000)).toEqual([1, 1]);
  });
});

describe("dropZoneAt", () => {
  const rect = { left: 100, width: 1000 };

  it("reads the outer 30% on each side as beside the pane, the middle as onto it", () => {
    expect(dropZoneAt(110, rect)).toBe("left");
    expect(dropZoneAt(1090, rect)).toBe("right");
    expect(dropZoneAt(600, rect)).toBe("center");
  });

  it("switches at the edge boundaries", () => {
    expect(dropZoneAt(100 + 299, rect)).toBe("left");
    expect(dropZoneAt(100 + 300, rect)).toBe("center");
    expect(dropZoneAt(100 + 700, rect)).toBe("center");
    expect(dropZoneAt(100 + 701, rect)).toBe("right");
  });

  it("falls back to onto the pane when it can't be measured", () => {
    expect(dropZoneAt(5, { left: 0, width: 0 })).toBe("center");
    expect(dropZoneAt(NaN, rect)).toBe("center");
  });
});
