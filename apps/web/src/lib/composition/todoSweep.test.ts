import { describe, expect, it } from "vitest";
import type { TodoEvent } from "./todoEvents";
import { planSweep, type SweepItem } from "./todoSweep";
import type { TodoStatus } from "./todosApi";

const week = { start: "2026-10-25", end: "2026-10-31" };

const item = (id: number, over: Partial<SweepItem> = {}): SweepItem => ({
  id,
  parentId: null,
  status: "todo",
  createdOn: "2026-10-26",
  archived: false,
  rolledFromWeek: null,
  rollCount: 0,
  ...over,
});

describe("planSweep, sub-items", () => {
  it("archives a whole subtree once everything in it is done", () => {
    const items = [
      item(1, { status: "done" }),
      item(2, { status: "done", parentId: 1 }),
      item(3, { status: "done", parentId: 2 }),
    ];

    expect(planSweep(items, [], [week])[0].archive).toEqual([1, 2, 3]);
  });

  it("keeps a done parent while one of its sub-items is open, and archives the sub-items that are done", () => {
    const items = [
      item(1, { status: "done" }),
      item(2, { status: "done", parentId: 1 }),
      item(3, { status: "todo", parentId: 1 }),
    ];

    const [plan] = planSweep(items, [], [week]);

    expect(plan.archive).toEqual([2]);
    expect(plan.roll.map((r) => r.id)).toEqual([3]);
  });

  it("rolls an open parent and archives its done sub-items", () => {
    const items = [item(1, { status: "todo" }), item(2, { status: "done", parentId: 1 })];

    const [plan] = planSweep(items, [], [week]);

    expect(plan.archive).toEqual([2]);
    expect(plan.roll.map((r) => r.id)).toEqual([1]);
  });

  it("counts a sub-item that is already archived as done", () => {
    const items = [
      item(1, { status: "done" }),
      item(2, { status: "done", parentId: 1, archived: true }),
      item(3, { status: "done", parentId: 1 }),
    ];

    expect(planSweep(items, [], [week])[0].archive).toEqual([1, 3]);
  });

  it("keeps a done parent whose sub-item is in the backlog, and leaves that sub-item alone", () => {
    const items = [item(1, { status: "done" }), item(2, { status: "backlog", parentId: 1 })];

    const [plan] = planSweep(items, [], [week]);

    expect(plan.archive).toEqual([]);
    expect(plan.roll).toEqual([]);
  });
});

const moved = (todoId: number, on: string, fromStatus: TodoStatus, toStatus: TodoStatus): TodoEvent => ({
  todoId,
  kind: "status_changed",
  at: `${on}T09:00:00.000Z`,
  on,
  fromStatus,
  toStatus,
});

describe("planSweep, an item as it was when the week ended", () => {
  it("leaves out an item that was made after the week ended", () => {
    const [plan] = planSweep([item(1, { createdOn: "2026-11-01" })], [], [week]);

    expect(plan).toEqual({ week, archive: [], roll: [] });
  });

  it("does not roll an item that was pulled out of the backlog after the week ended", () => {
    // The sweep ran late (Monday), but on Sunday the owner had already put this in the new week on purpose.
    const [plan] = planSweep([item(1)], [moved(1, "2026-11-01", "backlog", "todo")], [week]);

    expect(plan.roll).toEqual([]);
  });

  it("does not archive an item that was ticked after the week ended, but it was carried over", () => {
    const [plan] = planSweep([item(1, { status: "done" })], [moved(1, "2026-11-01", "todo", "done")], [week]);

    expect(plan.archive).toEqual([]);
    expect(plan.roll).toEqual([{ id: 1, rolledFromWeek: "2026-10-25", rollCount: 1 }]);
  });

  it("ignores a sub-item made after the week ended when deciding if a subtree is finished", () => {
    const items = [item(1, { status: "done" }), item(2, { status: "todo", parentId: 1, createdOn: "2026-11-02" })];

    const [plan] = planSweep(items, [], [week]);

    expect(plan.archive).toEqual([1]);
    expect(plan.roll).toEqual([]);
  });
});

describe("planSweep, roll counts", () => {
  it("keeps the original week of an item that is still waiting in Rolled over, and counts the close", () => {
    const waiting = item(1, { rolledFromWeek: "2026-10-18", rollCount: 1 });

    expect(planSweep([waiting], [], [week])[0].roll).toEqual([{ id: 1, rolledFromWeek: "2026-10-18", rollCount: 2 }]);
  });

  it("starts again from this week for an item that was added back to the week and not finished", () => {
    // Accepting an item clears rolledFromWeek but keeps the count of weeks it has been through.
    const accepted = item(1, { rolledFromWeek: null, rollCount: 1 });

    expect(planSweep([accepted], [], [week])[0].roll).toEqual([{ id: 1, rolledFromWeek: "2026-10-25", rollCount: 2 }]);
  });
});

describe("planSweep, several weeks", () => {
  const weeks = [
    { start: "2026-10-11", end: "2026-10-17" },
    { start: "2026-10-18", end: "2026-10-24" },
    { start: "2026-10-25", end: "2026-10-31" },
  ];

  it("closes the weeks in order, each starting from what the one before did", () => {
    const items = [item(1, { createdOn: "2026-10-12" }), item(2, { status: "done", createdOn: "2026-10-12" })];

    const plans = planSweep(items, [], weeks);

    expect(plans.map((p) => p.archive)).toEqual([[2], [], []]);
    expect(plans.map((p) => p.roll)).toEqual([
      [{ id: 1, rolledFromWeek: "2026-10-11", rollCount: 1 }],
      [{ id: 1, rolledFromWeek: "2026-10-11", rollCount: 2 }],
      [{ id: 1, rolledFromWeek: "2026-10-11", rollCount: 3 }],
    ]);
  });

  it("starts an item's count in the first week that it existed", () => {
    const plans = planSweep([item(1, { createdOn: "2026-10-20" })], [], weeks);

    expect(plans.map((p) => p.roll)).toEqual([
      [],
      [{ id: 1, rolledFromWeek: "2026-10-18", rollCount: 1 }],
      [{ id: 1, rolledFromWeek: "2026-10-18", rollCount: 2 }],
    ]);
  });

  it("carries an item over from the week it was open, and archives it at the close of the week it was ticked in", () => {
    const items = [item(1, { status: "done", createdOn: "2026-10-12" })];
    const events = [moved(1, "2026-10-20", "todo", "done")];

    const plans = planSweep(items, events, weeks);

    expect(plans.map((p) => p.archive)).toEqual([[], [1], []]);
    expect(plans.map((p) => p.roll.length)).toEqual([1, 0, 0]);
  });
});

describe("planSweep, one week", () => {
  it("has nothing to do for an empty list", () => {
    expect(planSweep([], [], [week])).toEqual([{ week, archive: [], roll: [] }]);
  });

  it("archives what is done, rolls what is open, and leaves the backlog alone", () => {
    const items = [
      item(1, { status: "done" }),
      item(2, { status: "todo" }),
      item(3, { status: "in_progress" }),
      item(4, { status: "backlog" }),
    ];

    expect(planSweep(items, [], [week])).toEqual([
      {
        week,
        archive: [1],
        roll: [
          { id: 2, rolledFromWeek: "2026-10-25", rollCount: 1 },
          { id: 3, rolledFromWeek: "2026-10-25", rollCount: 1 },
        ],
      },
    ]);
  });
});
