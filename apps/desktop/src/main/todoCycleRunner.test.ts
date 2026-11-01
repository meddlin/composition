import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TODOS_CHANGED_CHANNEL } from "../shared/channels";
import { broadcastTodosChanged, createTodoCycleRunner, notifyTodoReports } from "./todoCycleRunner";

const HOUR = 60 * 60 * 1000;
const idle = { awaitingSetup: false, closedWeeks: 0, purged: 0, reportNotes: [] as number[] };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the weekly cycle's scheduler", () => {
  it("runs once as it starts, so a week that ended while the app was closed is closed before the window shows, and then every hour", () => {
    const run = vi.fn(() => idle);
    const runner = createTodoCycleRunner({ run, announce: vi.fn(), log: vi.fn() });

    runner.start();
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(HOUR - 1);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3 * HOUR);
    expect(run).toHaveBeenCalledTimes(5);
    runner.stop();
  });

  it("tells the windows only when a week was closed or items were purged", () => {
    const results = [
      idle,
      { ...idle, awaitingSetup: true },
      { ...idle, closedWeeks: 2 },
      { ...idle, purged: 5 },
      idle,
    ];
    const run = vi.fn(() => results.shift()!);
    const announce = vi.fn();
    const runner = createTodoCycleRunner({ run, announce, log: vi.fn() });

    runner.start(); // idle
    vi.advanceTimersByTime(HOUR); // a first run still waiting for the owner
    expect(announce).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR); // two weeks closed
    expect(announce).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOUR); // purged
    expect(announce).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(HOUR); // idle
    expect(announce).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("tells the windows when a month ended in the middle of a week and only its report was made", () => {
    const run = vi.fn().mockReturnValueOnce({ ...idle, reportNotes: [41] }).mockReturnValue(idle);
    const announce = vi.fn();
    const runner = createTodoCycleRunner({ run, announce, log: vi.fn() });

    runner.start();

    expect(announce).toHaveBeenCalledTimes(1);
    runner.stop();
  });

  it("has the search told about the reports a run made, before it tells the windows", () => {
    const events: string[] = [];
    const run = vi.fn(() => ({ ...idle, reportNotes: [41, 42] }));
    const runner = createTodoCycleRunner({
      run,
      announce: () => events.push("announce"),
      indexReports: (ids) => events.push(`index ${ids.join(",")}`),
      log: vi.fn(),
    });

    runner.start();

    expect(events).toEqual(["index 41,42", "announce"]);
    runner.stop();
  });

  it("logs a run that fails and goes on to the next one", () => {
    const run = vi
      .fn<() => typeof idle>()
      .mockImplementationOnce(() => {
        throw new Error("database is locked");
      })
      .mockReturnValue(idle);
    const log = vi.fn();
    const runner = createTodoCycleRunner({ run, announce: vi.fn(), log });

    expect(() => runner.start()).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("to-do"), expect.stringContaining("database is locked"));

    vi.advanceTimersByTime(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("stops for good, and starting it twice does not run it twice as often", () => {
    const run = vi.fn(() => idle);
    const runner = createTodoCycleRunner({ run, announce: vi.fn(), log: vi.fn() });

    runner.start();
    runner.start();
    vi.advanceTimersByTime(HOUR);
    expect(run).toHaveBeenCalledTimes(2);

    runner.stop();
    vi.advanceTimersByTime(5 * HOUR);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("notifyTodoReports", () => {
  const api = () => ({
    generateTodoReport: vi.fn(async (kind: string, periodStart: string) => ({ noteId: 7, kind, periodStart })),
    listTodos: vi.fn(async () => []),
  });

  it("tells the windows once a report has been made, so each can show the new note", async () => {
    const announce = vi.fn();
    const wrapped = notifyTodoReports(api(), announce);

    await expect(wrapped.generateTodoReport("weekly", "2026-10-18")).resolves.toEqual({ noteId: 7, kind: "weekly", periodStart: "2026-10-18" });

    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the report could not be made, and leaves every other call alone", async () => {
    const announce = vi.fn();
    const base = api();
    base.generateTodoReport.mockRejectedValueOnce(new Error("not closed"));
    const wrapped = notifyTodoReports(base, announce);

    await expect(wrapped.generateTodoReport("weekly", "x")).rejects.toThrow("not closed");
    await wrapped.listTodos();

    expect(announce).not.toHaveBeenCalled();
    expect(base.listTodos).toHaveBeenCalledTimes(1);
  });
});

describe("broadcastTodosChanged", () => {
  const window_ = (destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { send: vi.fn() } });

  it("tells every open window to read the list again, and skips one that has gone", () => {
    const [one, two, gone] = [window_(), window_(), window_(true)];

    broadcastTodosChanged([one, two, gone]);

    expect(one.webContents.send).toHaveBeenCalledWith(TODOS_CHANGED_CHANNEL);
    expect(two.webContents.send).toHaveBeenCalledWith(TODOS_CHANGED_CHANNEL);
    expect(gone.webContents.send).not.toHaveBeenCalled();
  });
});
