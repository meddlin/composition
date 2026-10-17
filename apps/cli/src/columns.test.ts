import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawnSidebar, loadColumns, resizeEditorShare, resizeSidebar, saveColumns } from "./columns";

describe("resizeSidebar", () => {
  it("moves two columns at a time, inside 20 to 60", () => {
    expect(resizeSidebar(34, 1)).toBe(36);
    expect(resizeSidebar(34, -1)).toBe(32);
    expect(resizeSidebar(20, -1)).toBe(20);
    expect(resizeSidebar(60, 1)).toBe(60);
  });
});

describe("resizeEditorShare", () => {
  it("moves a tenth at a time, inside 0.2 to 0.8, without rounding drift", () => {
    expect(resizeEditorShare(0.5, 1)).toBe(0.6);
    expect(resizeEditorShare(0.7, 1)).toBe(0.8);
    expect(resizeEditorShare(0.8, 1)).toBe(0.8);
    expect(resizeEditorShare(0.3, -1)).toBe(0.2);
    expect(resizeEditorShare(0.2, -1)).toBe(0.2);
  });
});

describe("drawnSidebar", () => {
  it("is as wide as asked when the terminal has room", () => {
    expect(drawnSidebar(50, 160)).toBe(50);
  });

  it("leaves the panes room in a narrower terminal, but never goes below the default width", () => {
    expect(drawnSidebar(50, 70)).toBe(40);
    expect(drawnSidebar(50, 50)).toBe(34);
    expect(drawnSidebar(24, 40)).toBe(24);
  });
});

describe("saved columns", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-columns-"));
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", path.join(home, "settings.json"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("starts at 34 columns and an even split", () => {
    expect(loadColumns()).toEqual({ sidebarColumns: 34, editorRatio: 0.5 });
  });

  it("remembers what was saved, and leaves the other settings alone", () => {
    fs.writeFileSync(path.join(home, "settings.json"), JSON.stringify({ appDataDir: "/somewhere", theme: "forest", sidebarWidth: 300 }));

    saveColumns({ sidebarColumns: 44, editorRatio: 0.7 });

    expect(loadColumns()).toEqual({ sidebarColumns: 44, editorRatio: 0.7 });
    expect(JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8"))).toMatchObject({
      appDataDir: "/somewhere",
      theme: "forest",
      sidebarWidth: 300, // the pixel width other apps use is not touched
    });
  });
});
