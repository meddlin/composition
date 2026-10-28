import { describe, expect, it, vi } from "vitest";
import { APPEARANCE_CHANNEL } from "../shared/channels";
import { broadcastAppearance, notifyAppearanceChanges, type AppearanceMessage } from "./appearance";

const appearance: AppearanceMessage = {
  theme: "forest",
  previewFont: "default",
  editorFont: "default",
  noteBackground: "plain",
  translucent: false,
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
    saveLocation: vi.fn(async (_city: string): Promise<{ error?: string }> => ({})),
    saveFavorites: vi.fn(async () => {}),
  });

  it.each(["saveTheme", "savePreviewFont", "saveEditorFont", "saveLocation"] as const)(
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
