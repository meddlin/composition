import { describe, expect, it, vi } from "vitest";
import type { SunHours } from "../../../web/src/lib/composition/sunHours";
import { APPEARANCE_CHANNEL } from "../shared/channels";
import { broadcastAppearance, notifyAppearanceChanges, notifyTranslucencyChange, type AppearanceMessage } from "./appearance";

const appearance: AppearanceMessage = {
  theme: "forest",
  previewFont: "default",
  editorFont: "default",
  noteBackground: "plain",
  sunPair: "classic",
  translucent: false,
  opacity: 0.8,
  sun: { tone: "dark", autoLight: "0.2" },
};

const window_ = (destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { send: vi.fn() } });

describe("broadcastAppearance", () => {
  it("tells every window the colors and fonts now, and skips one that has gone", () => {
    const [one, two, gone] = [window_(), window_(), window_(true)];

    broadcastAppearance([one, two, gone], appearance);

    expect(one.webContents.send).toHaveBeenCalledWith(APPEARANCE_CHANNEL, appearance);
    expect(two.webContents.send).toHaveBeenCalledWith(APPEARANCE_CHANNEL, appearance);
    expect(gone.webContents.send).not.toHaveBeenCalled();
  });
});

describe("notifyAppearanceChanges", () => {
  const api = () => ({
    saveTheme: vi.fn(async (_theme: string): Promise<{ error?: string }> => ({})),
    savePreviewFont: vi.fn(async (_font: string): Promise<{ error?: string }> => ({})),
    saveEditorFont: vi.fn(async (_font: string): Promise<{ error?: string }> => ({})),
    saveSunHours: vi.fn(async (_hours: SunHours): Promise<{ error?: string }> => ({})),
    saveNoteBackground: vi.fn(async (_background: string): Promise<{ error?: string }> => ({})),
    saveSunPair: vi.fn(async (_pair: string): Promise<{ error?: string }> => ({})),
    saveFavorites: vi.fn(async () => {}),
  });

  it.each(["saveTheme", "savePreviewFont", "saveEditorFont", "saveNoteBackground", "saveSunPair"] as const)(
    "announces the new appearance once %s has gone through, and returns what it returned",
    async (method) => {
      const inner = api();
      const announce = vi.fn();
      const wrapped = notifyAppearanceChanges(inner, announce);

      const result = await wrapped[method]("x");

      expect(result).toEqual({});
      expect(inner[method]).toHaveBeenCalledWith("x");
      expect(announce).toHaveBeenCalledTimes(1);
    },
  );

  it("announces the new appearance once the Follow the sun hours have been saved, and returns what saving them returned", async () => {
    const inner = api();
    const announce = vi.fn();
    const hours = { lightenFrom: "19:00", lightFrom: "20:00", darkenFrom: "05:00", darkFrom: "06:00" };

    const result = await notifyAppearanceChanges(inner, announce).saveSunHours(hours);

    expect(result).toEqual({});
    expect(inner.saveSunHours).toHaveBeenCalledWith(hours);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("announces nothing when the hours were refused", async () => {
    const inner = api();
    inner.saveSunHours.mockResolvedValue({ error: "Not in order" });
    const announce = vi.fn();

    const result = await notifyAppearanceChanges(inner, announce).saveSunHours({ lightenFrom: "08:00", lightFrom: "07:00", darkenFrom: "18:00", darkFrom: "19:00" });

    expect(result).toEqual({ error: "Not in order" });
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces nothing when the change was refused", async () => {
    const inner = api();
    inner.saveTheme.mockResolvedValue({ error: "No such scheme" });
    const announce = vi.fn();

    const result = await notifyAppearanceChanges(inner, announce).saveTheme("nope");

    expect(result).toEqual({ error: "No such scheme" });
    expect(announce).not.toHaveBeenCalled();
  });

  it("announces nothing when saving failed, and lets the failure through", async () => {
    const inner = api();
    inner.savePreviewFont.mockRejectedValue(new Error("disk full"));
    const announce = vi.fn();

    await expect(notifyAppearanceChanges(inner, announce).savePreviewFont("serif")).rejects.toThrow("disk full");
    expect(announce).not.toHaveBeenCalled();
  });

  it("leaves everything else alone", async () => {
    const inner = api();
    const announce = vi.fn();

    await notifyAppearanceChanges(inner, announce).saveFavorites();

    expect(inner.saveFavorites).toHaveBeenCalledTimes(1);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe("notifyTranslucencyChange", () => {
  const api = () => ({
    getWindowTranslucency: vi.fn(async () => ({ supported: true, enabled: true, opacity: 0.8 })),
    setWindowTranslucency: vi.fn(async (enabled: boolean) => ({ supported: true, enabled, opacity: 0.8 })),
    setWindowOpacity: vi.fn(async (opacity: number) => ({ supported: true, enabled: true, opacity })),
  });

  it("announces the new appearance once the see-through look has been changed, and returns the state it returned", async () => {
    const inner = api();
    const announce = vi.fn();

    const state = await notifyTranslucencyChange(inner, announce).setWindowTranslucency(false);

    expect(state).toEqual({ supported: true, enabled: false, opacity: 0.8 });
    expect(inner.setWindowTranslucency).toHaveBeenCalledWith(false);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("announces it after the change, so what is announced is the new look", async () => {
    const order: string[] = [];
    const inner = api();
    inner.setWindowTranslucency.mockImplementation(async (enabled) => {
      order.push("changed");
      return { supported: true, enabled, opacity: 0.8 };
    });

    await notifyTranslucencyChange(inner, () => order.push("announced")).setWindowTranslucency(true);

    expect(order).toEqual(["changed", "announced"]);
  });

  it("announces a new opacity too", async () => {
    const announce = vi.fn();
    const state = await notifyTranslucencyChange(api(), announce).setWindowOpacity(0.5);
    expect(state.opacity).toBe(0.5);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it("announces nothing for a read, or when the change failed", async () => {
    const inner = api();
    const announce = vi.fn();
    const wrapped = notifyTranslucencyChange(inner, announce);

    await wrapped.getWindowTranslucency();
    inner.setWindowTranslucency.mockRejectedValue(new Error("no window"));
    await expect(wrapped.setWindowTranslucency(true)).rejects.toThrow("no window");

    expect(announce).not.toHaveBeenCalled();
  });
});
