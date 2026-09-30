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

describe("moveGroup", () => {
  it("reparents a group and lets it return to the top level", async () => {
    const { createGroup, moveGroup } = await import("./actions");
    const a = await createGroup("A", null);
    const b = await createGroup("B", null);

    const moved = await moveGroup(b.id, a.id);
    expect(moved.group).toMatchObject({ id: b.id, parentId: a.id });

    const back = await moveGroup(b.id, null);
    expect(back.group).toMatchObject({ id: b.id, parentId: null });
  });

  it("refuses to move a group into itself or one of its descendants", async () => {
    const { createGroup, moveGroup } = await import("./actions");
    const { getGroup } = await import("./groupsRepo");
    const a = await createGroup("A", null);
    const b = await createGroup("B", a.id);
    const c = await createGroup("C", b.id);

    expect(await moveGroup(a.id, a.id)).toEqual({ error: expect.any(String) });
    expect(await moveGroup(a.id, c.id)).toEqual({ error: expect.any(String) });
    expect(getGroup(a.id)?.parentId).toBeNull();
  });

  it("reports a missing group instead of throwing", async () => {
    const { createGroup, moveGroup } = await import("./actions");
    const a = await createGroup("A", null);

    expect(await moveGroup(a.id, 999)).toEqual({ error: expect.any(String) });
    expect(await moveGroup(999, null)).toEqual({ error: expect.any(String) });
  });
});
