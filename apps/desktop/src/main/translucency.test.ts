import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWindowPrefsStore,
  createWindowTranslucency,
  TRANSLUCENT_BACKGROUND,
  WINDOW_VIBRANCY,
  type WindowPrefsStore,
} from "./translucency";

let dir: string;
beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "window-prefs-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("createWindowPrefsStore", () => {
  it("is translucent when there is no file yet", () => {
    expect(createWindowPrefsStore(path.join(dir, "window.json")).load()).toEqual({ translucent: true });
  });

  it("remembers the choice, creating the folder if needed", () => {
    const file = path.join(dir, "nested", "window.json");
    createWindowPrefsStore(file).save({ translucent: false });
    expect(createWindowPrefsStore(file).load()).toEqual({ translucent: false });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["window.json"]);
  });

  it.each([["not json"], ["null"], ["[]"], ['{"translucent":"no"}'], ["{}"]])("falls back to translucent for %s", (contents) => {
    const file = path.join(dir, "window.json");
    fs.writeFileSync(file, contents);
    expect(createWindowPrefsStore(file).load()).toEqual({ translucent: true });
  });
});

function setup(options: { platform?: string; translucent?: boolean } = {}) {
  const saved: boolean[] = [];
  const prefs: WindowPrefsStore = {
    load: () => ({ translucent: options.translucent ?? true }),
    save: ({ translucent }) => void saved.push(translucent),
  };
  const window = { setVibrancy: vi.fn(), setBackgroundColor: vi.fn() };
  const controller = createWindowTranslucency({
    platform: options.platform ?? "darwin",
    prefs,
    windows: () => [window],
    solidBackground: () => "#121212",
  });
  return { controller, window, saved };
}

describe("createWindowTranslucency", () => {
  it("is active on macOS when the person wants it, with a see-through background", async () => {
    const { controller } = setup();
    expect(controller.isActive()).toBe(true);
    expect(controller.backgroundColor()).toBe(TRANSLUCENT_BACKGROUND);
    expect(await controller.getWindowTranslucency()).toEqual({ supported: true, enabled: true });
  });

  it("is never active elsewhere, whatever was saved, and says it is unsupported", async () => {
    const { controller, window } = setup({ platform: "linux" });
    expect(controller.isActive()).toBe(false);
    expect(controller.backgroundColor()).toBe("#121212");
    expect(await controller.setWindowTranslucency(true)).toEqual({ supported: false, enabled: true });
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });

  it("is not active when the person turned it off", () => {
    const { controller } = setup({ translucent: false });
    expect(controller.isActive()).toBe(false);
    expect(controller.backgroundColor()).toBe("#121212");
  });

  it("turns an open window solid at once, and saves the choice", async () => {
    const { controller, window, saved } = setup();
    expect(await controller.setWindowTranslucency(false)).toEqual({ supported: true, enabled: false });
    expect(window.setVibrancy).toHaveBeenCalledWith(null);
    expect(window.setBackgroundColor).toHaveBeenCalledWith("#121212");
    expect(saved).toEqual([false]);
  });

  it("turns an open window translucent again", async () => {
    const { controller, window } = setup({ translucent: false });
    await controller.setWindowTranslucency(true);
    expect(window.setVibrancy).toHaveBeenCalledWith(WINDOW_VIBRANCY);
    expect(window.setBackgroundColor).toHaveBeenCalledWith(TRANSLUCENT_BACKGROUND);
  });

  it("does nothing when the choice has not changed", async () => {
    const { controller, window, saved } = setup();
    await controller.setWindowTranslucency(true);
    expect(window.setVibrancy).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });
});
