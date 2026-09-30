import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/composition/db", () => ({ closeDb: vi.fn() }));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-settings-actions-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("saveSettingsAction", () => {
  it("keeps the theme and column layout when the data location is saved", async () => {
    const { loadWebSettings, saveWebSettings } = await import("@/lib/composition/webSettings");
    saveWebSettings({
      ...loadWebSettings(),
      theme: "forest",
      sidebarWidth: 320,
      editorRatio: 0.3,
    });
    const { saveSettingsAction } = await import("./actions");

    const result = await saveSettingsAction({}, form({ appDataDir: path.join(home, "notes"), dbPath: "" }));

    expect(result.success).toBe(true);
    expect(loadWebSettings()).toEqual({
      appDataDir: path.join(home, "notes"),
      theme: "forest",
      sidebarWidth: 320,
      editorRatio: 0.3,
    });
  });

  it("drops a previously stored dbPath when the field is cleared", async () => {
    const { loadWebSettings, saveWebSettings } = await import("@/lib/composition/webSettings");
    saveWebSettings({ ...loadWebSettings(), dbPath: path.join(home, "old.db") });
    const { saveSettingsAction } = await import("./actions");

    await saveSettingsAction({}, form({ appDataDir: path.join(home, "notes"), dbPath: "" }));

    expect(loadWebSettings().dbPath).toBeUndefined();
  });
});
