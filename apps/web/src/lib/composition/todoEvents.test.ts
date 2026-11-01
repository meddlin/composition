import { describe, expect, it } from "vitest";
import { statusAsOf, type TodoEvent } from "./todoEvents";
import type { TodoStatus } from "./todosApi";

const change = (on: string, fromStatus: TodoStatus, toStatus: TodoStatus): TodoEvent => ({
  todoId: 1,
  kind: "status_changed",
  at: `${on}T12:00:00.000Z`,
  on,
  fromStatus,
  toStatus,
});

describe("statusAsOf", () => {
  it("is the current status when nothing changed after the date", () => {
    expect(statusAsOf("todo", [], "2026-10-31")).toBe("todo");
    expect(statusAsOf("done", [change("2026-10-28", "todo", "done")], "2026-10-31")).toBe("done");
  });

  it("is the status the item had before the first change made after the date", () => {
    // Pulled out of the backlog on Sunday: at the end of the Saturday before, it was still in the backlog.
    const events = [change("2026-11-01", "backlog", "todo")];

    expect(statusAsOf("todo", events, "2026-10-31")).toBe("backlog");
  });

  it("looks back through several later changes to the first of them", () => {
    const events = [change("2026-11-01", "backlog", "todo"), change("2026-11-02", "todo", "done")];

    expect(statusAsOf("done", events, "2026-10-31")).toBe("backlog");
    expect(statusAsOf("done", events, "2026-11-01")).toBe("todo");
    expect(statusAsOf("done", events, "2026-11-02")).toBe("done");
  });

  it("counts a change made on the date itself", () => {
    expect(statusAsOf("done", [change("2026-10-31", "todo", "done")], "2026-10-31")).toBe("done");
  });

  it("ignores events that are not status changes", () => {
    const rename: TodoEvent = { todoId: 1, kind: "renamed", at: "2026-11-01T12:00:00.000Z", on: "2026-11-01" };

    expect(statusAsOf("todo", [rename], "2026-10-31")).toBe("todo");
  });
});
