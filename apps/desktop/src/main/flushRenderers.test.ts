import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLUSH_SCRIPT, flushRenderers } from "./flushRenderers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function windowThat(run: () => Promise<unknown>, destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { executeJavaScript: vi.fn(run) } };
}

describe("flushRenderers", () => {
  it("asks every window that is there to send what is still waiting to be saved, and waits for the answer", async () => {
    let answer!: () => void;
    const slow = windowThat(() => new Promise<void>((resolve) => (answer = resolve)));
    const quick = windowThat(async () => undefined);
    const gone = windowThat(async () => undefined, true);

    let done = false;
    const flushed = flushRenderers([slow, quick, gone], 2000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);

    expect(slow.webContents.executeJavaScript).toHaveBeenCalledWith(FLUSH_SCRIPT);
    expect(quick.webContents.executeJavaScript).toHaveBeenCalledWith(FLUSH_SCRIPT);
    expect(gone.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(done).toBe(false);

    answer();
    await flushed;
    expect(done).toBe(true);
  });

  it("does not wait for ever on a window that never answers, so quitting cannot hang on it", async () => {
    const stuck = windowThat(() => new Promise(() => {}));

    let done = false;
    const flushed = flushRenderers([stuck], 2000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await flushed;

    expect(done).toBe(true);
  });

  it("carries on with the others when one window fails, as when its page is already gone", async () => {
    const broken = windowThat(async () => Promise.reject(new Error("Render frame was disposed")));
    const fine = windowThat(async () => undefined);

    await expect(flushRenderers([broken, fine], 2000)).resolves.toBeUndefined();
    expect(fine.webContents.executeJavaScript).toHaveBeenCalled();
  });

  it("is done at once when there are no windows", async () => {
    await expect(flushRenderers([], 2000)).resolves.toBeUndefined();
  });
});

describe("FLUSH_SCRIPT", () => {
  /** Runs the script as a page would, with the `window` it is given. */
  const runIn = (window: object) => new Function("window", `return ${FLUSH_SCRIPT}`)(window) as Promise<unknown>;

  it("flushes the workspace the page holds, and waits for it", async () => {
    let flushed = false;
    const store = { flushSaves: vi.fn(async () => void (flushed = true)) };

    await runIn({ __workspace: { store } });

    expect(store.flushSaves).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(true);
  });

  it("does nothing in a page that holds no workspace, such as a pop-out or Settings opened first", async () => {
    await expect(runIn({})).resolves.toBeUndefined();
  });
});
