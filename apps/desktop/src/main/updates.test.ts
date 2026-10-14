import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "../../../web/src/lib/composition/updatesApi";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  releaseNotesText,
  UpdateManager,
  type UpdaterLike,
  type UpdateManagerOptions,
} from "./updates";

type CheckResult = Awaited<ReturnType<UpdaterLike["checkForUpdates"]>>;

const found = (version: string, releaseNotes?: string): CheckResult => ({
  isUpdateAvailable: true,
  updateInfo: { version, releaseNotes },
});
const none: CheckResult = { isUpdateAvailable: false, updateInfo: { version: "0.1.3" } };

function setup(overrides: Partial<UpdateManagerOptions> = {}, autoCheck = true) {
  let progress: (p: { percent: number }) => void = () => {};
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    checkForUpdates: vi.fn(async (): Promise<CheckResult> => none),
    downloadUpdate: vi.fn(async () => ["update.zip"]),
    quitAndInstall: vi.fn(),
    on: vi.fn((_event: "download-progress", listener: (p: { percent: number }) => void) => {
      progress = listener;
    }),
  };
  const saved: { autoCheck: boolean }[] = [];
  const changes: UpdateState[] = [];
  const order: string[] = [];
  const manager = new UpdateManager({
    updater,
    currentVersion: "0.1.3",
    support: { ok: true },
    prefs: { load: () => ({ autoCheck }), save: (prefs) => void saved.push(prefs) },
    prepareToQuit: async () => void order.push("cleanup"),
    onChange: (state) => void changes.push(state),
    now: () => new Date("2026-10-14T12:00:00Z"),
    ...overrides,
  });
  updater.quitAndInstall.mockImplementation(() => void order.push("quitAndInstall"));
  return { manager, updater, saved, changes, order, progress: (percent: number) => progress({ percent }) };
}

describe("UpdateManager", () => {
  it("configures the updater to ask first, install on quit and ignore pre-releases", () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowPrerelease).toBe(false);
  });

  it("starts idle with the running version and the stored preference", async () => {
    const { manager } = setup({}, false);
    expect(await manager.getUpdateState()).toEqual({
      phase: "idle",
      currentVersion: "0.1.3",
      supported: true,
      autoCheck: false,
    });
  });

  describe("checking", () => {
    it("announces a newer version without downloading it", async () => {
      const { manager, updater } = setup();
      updater.checkForUpdates.mockResolvedValue(found("0.2.0", "<p>Faster search</p>"));
      const state = await manager.checkForUpdates();
      expect(state).toMatchObject({
        phase: "available",
        version: "0.2.0",
        releaseNotes: "Faster search",
        lastCheckedAt: "2026-10-14T12:00:00.000Z",
      });
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
    });

    it("goes through 'checking' and ends idle when there is nothing newer", async () => {
      const { manager, changes } = setup();
      const state = await manager.checkForUpdates();
      expect(changes.map((s) => s.phase)).toEqual(["checking", "idle"]);
      expect(state).toMatchObject({ phase: "idle", lastCheckedAt: "2026-10-14T12:00:00.000Z" });
      expect(state).not.toHaveProperty("version");
    });

    it("treats a null result as up to date", async () => {
      const { manager, updater } = setup();
      updater.checkForUpdates.mockResolvedValue(null);
      expect((await manager.checkForUpdates()).phase).toBe("idle");
    });

    it("runs one check at a time", async () => {
      const { manager, updater } = setup();
      const [a, b] = await Promise.all([manager.checkForUpdates(), manager.checkForUpdates()]);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });

    it("reports a failed check the person asked for", async () => {
      const { manager, updater } = setup();
      updater.checkForUpdates.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));
      expect(await manager.checkForUpdates()).toMatchObject({
        phase: "error",
        error: "net::ERR_INTERNET_DISCONNECTED",
      });
    });

    it("clears an old error when the next check works", async () => {
      const { manager, updater } = setup();
      updater.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
      await manager.checkForUpdates();
      const state = await manager.checkForUpdates();
      expect(state.phase).toBe("idle");
      expect(state).not.toHaveProperty("error");
    });

    it("never touches the network when updates aren't supported", async () => {
      const { manager, updater } = setup({ support: { ok: false, reason: "Updates only work in the installed app." } });
      const state = await manager.checkForUpdates();
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
      expect(state).toMatchObject({ phase: "idle", supported: false, unsupportedReason: "Updates only work in the installed app." });
    });
  });

  describe("downloading", () => {
    async function available() {
      const ctx = setup();
      ctx.updater.checkForUpdates.mockResolvedValue(found("0.2.0"));
      await ctx.manager.checkForUpdates();
      return ctx;
    }

    it("downloads only after being asked, reporting each whole percent once", async () => {
      const { manager, updater, progress, changes } = await available();
      updater.downloadUpdate.mockImplementation(async () => {
        progress(10.2);
        progress(10.9);
        progress(55);
        return ["update.zip"];
      });
      const state = await manager.downloadUpdate();
      expect(state).toMatchObject({ phase: "ready", version: "0.2.0" });
      expect(state).not.toHaveProperty("percent");
      const percents = changes.filter((s) => s.phase === "downloading").map((s) => s.percent);
      expect(percents).toEqual([0, 10, 55]);
    });

    it("keeps the version when the download fails, so the message can name it", async () => {
      const { manager, updater } = await available();
      updater.downloadUpdate.mockRejectedValue(new Error("sha512 checksum mismatch"));
      expect(await manager.downloadUpdate()).toMatchObject({
        phase: "error",
        error: "sha512 checksum mismatch",
        version: "0.2.0",
      });
    });

    it("does nothing unless an update was announced", async () => {
      const { manager, updater } = setup();
      expect((await manager.downloadUpdate()).phase).toBe("idle");
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
    });

    it("doesn't check again while an update is downloaded and waiting", async () => {
      const { manager, updater } = await available();
      await manager.downloadUpdate();
      updater.checkForUpdates.mockClear();
      expect((await manager.checkForUpdates()).phase).toBe("ready");
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
    });
  });

  describe("installing", () => {
    it("cleans up first, then restarts into the update", async () => {
      const { manager, updater, order } = setup();
      updater.checkForUpdates.mockResolvedValue(found("0.2.0"));
      await manager.checkForUpdates();
      await manager.downloadUpdate();
      await manager.installUpdate();
      expect(order).toEqual(["cleanup", "quitAndInstall"]);
    });

    it("restarts even if the cleanup throws", async () => {
      const { manager, updater } = setup({
        prepareToQuit: async () => {
          throw new Error("db busy");
        },
      });
      updater.checkForUpdates.mockResolvedValue(found("0.2.0"));
      await manager.checkForUpdates();
      await manager.downloadUpdate();
      await manager.installUpdate();
      expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    });

    it("refuses to restart unless the update is downloaded", async () => {
      const { manager, updater, order } = setup();
      updater.checkForUpdates.mockResolvedValue(found("0.2.0"));
      await manager.checkForUpdates();
      await manager.installUpdate();
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
      expect(order).toEqual([]);
    });
  });

  describe("the preference", () => {
    it("is saved and shown", async () => {
      const { manager, saved } = setup();
      const state = await manager.setAutoCheckUpdates(false);
      expect(saved).toEqual([{ autoCheck: false }]);
      expect(state.autoCheck).toBe(false);
    });

    it("checks straight away when turned on", async () => {
      const { manager, updater } = setup({}, false);
      await manager.setAutoCheckUpdates(true);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    });

    it("ignores anything that isn't a boolean", async () => {
      const { manager, saved } = setup();
      await manager.setAutoCheckUpdates("yes" as unknown as boolean);
      expect(saved).toEqual([]);
    });
  });

  describe("the schedule", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("checks once after launch, then on the interval, and says nothing when offline", async () => {
      const { manager, updater, changes } = setup();
      updater.checkForUpdates.mockRejectedValue(new Error("offline"));
      manager.start();

      await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);

      expect(changes.some((s) => s.phase === "error")).toBe(false);
      expect((await manager.getUpdateState()).phase).toBe("idle");
      manager.stop();
    });

    it("skips scheduled checks while the preference is off, and resumes when it's on", async () => {
      const { manager, updater } = setup({}, false);
      manager.start();
      await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
      expect(updater.checkForUpdates).not.toHaveBeenCalled();

      await manager.setAutoCheckUpdates(true);
      updater.checkForUpdates.mockClear();
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
      manager.stop();
    });

    it("stops scheduling after stop()", async () => {
      const { manager, updater } = setup();
      manager.start();
      manager.stop();
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
    });
  });
});

describe("releaseNotesText", () => {
  it("passes plain text, strips tags, joins lists, and drops empties", () => {
    expect(releaseNotesText("Faster search")).toBe("Faster search");
    expect(releaseNotesText("<h2>New</h2><ul><li>Updates</li><li>Fixes</li></ul>")).toBe("New\nUpdates\nFixes");
    expect(releaseNotesText([{ note: "One" }, { note: null }, { note: "Two" }])).toBe("One\n\nTwo");
    expect(releaseNotesText("   ")).toBeUndefined();
    expect(releaseNotesText(null)).toBeUndefined();
    expect(releaseNotesText(undefined)).toBeUndefined();
  });
});
