import { describe, expect, it, vi } from "vitest";
import { startFeedRefresh } from "./feedRefresh";

function harness(state: { enabled: boolean; hasWindow: boolean }, refreshAll: () => Promise<unknown>) {
  let tick: () => void = () => {};
  const clear = vi.fn();
  const stop = startFeedRefresh({
    enabled: () => state.enabled,
    hasWindow: () => state.hasWindow,
    refreshAll,
    intervalMs: 1000,
    setInterval: (callback) => ((tick = callback), "handle"),
    clearInterval: clear,
  });
  return { tick: () => tick(), stop, clear };
}

describe("startFeedRefresh", () => {
  it("refreshes on a tick while the plugin is on and a window is open", () => {
    const refreshAll = vi.fn(async () => {});
    const { tick } = harness({ enabled: true, hasWindow: true }, refreshAll);

    tick();

    expect(refreshAll).toHaveBeenCalledTimes(1);
  });

  it("does nothing once the plugin is off, or with no window, and resumes when it is back", () => {
    const refreshAll = vi.fn(async () => {});
    const state = { enabled: false, hasWindow: true };
    const { tick } = harness(state, refreshAll);

    tick();
    state.enabled = true;
    state.hasWindow = false;
    tick();
    expect(refreshAll).not.toHaveBeenCalled();

    state.hasWindow = true;
    tick();
    expect(refreshAll).toHaveBeenCalledTimes(1);
  });

  it("skips a tick while the last refresh is still running, and survives a failure", async () => {
    let finish: () => void = () => {};
    const refreshAll = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { tick } = harness({ enabled: true, hasWindow: true }, refreshAll);

    tick();
    tick();
    expect(refreshAll).toHaveBeenCalledTimes(1);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    refreshAll.mockRejectedValueOnce(new Error("boom"));
    tick();
    await Promise.resolve();
    await Promise.resolve();
    tick();
    expect(refreshAll).toHaveBeenCalledTimes(3);
  });

  it("stops the timer", () => {
    const { stop, clear } = harness({ enabled: true, hasWindow: true }, async () => {});
    stop();
    expect(clear).toHaveBeenCalledWith("handle");
  });
});
