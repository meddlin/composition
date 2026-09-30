import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SIDEBAR_WIDTH, MIN_EDITOR_RATIO } from "./layout";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-actions-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("saveLayout", () => {
  it("persists the layout and leaves the other settings alone", async () => {
    const { saveWebSettings, loadWebSettings } = await import("./webSettings");
    saveWebSettings({ ...loadWebSettings(), appDataDir: "/data", dbPath: "/data/x.db", theme: "forest" });
    const { saveLayout } = await import("./actions");

    await saveLayout({ sidebarWidth: 300, editorRatio: 0.4 });

    expect(loadWebSettings()).toMatchObject({
      appDataDir: "/data",
      dbPath: "/data/x.db",
      theme: "forest",
      sidebarWidth: 300,
      editorRatio: 0.4,
    });
  });

  it("clamps values it is sent rather than trusting the client", async () => {
    const { loadWebSettings } = await import("./webSettings");
    const { saveLayout } = await import("./actions");

    await saveLayout({ sidebarWidth: 1e9, editorRatio: -3 });

    expect(loadWebSettings()).toMatchObject({
      sidebarWidth: MAX_SIDEBAR_WIDTH,
      editorRatio: MIN_EDITOR_RATIO,
    });
  });
});
