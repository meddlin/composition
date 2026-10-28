import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWindowState, type DisplayArea } from "./windowState";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "composition-window-state-"));
  file = path.join(dir, "window-state.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const laptop: DisplayArea = { x: 0, y: 25, width: 1440, height: 875 };
const monitor: DisplayArea = { x: 1440, y: 0, width: 1920, height: 1080 };

describe("window state", () => {
  it("knows nothing about a window it has not seen", () => {
    expect(createWindowState({ file, displays: () => [laptop] }).boundsFor("w1")).toBeUndefined();
  });

  it("remembers where a window was, across launches", () => {
    const first = createWindowState({ file, displays: () => [laptop] });
    first.remember("w1", { x: 100, y: 120, width: 800, height: 600 });
    first.remember("w2", { x: 300, y: 200, width: 640, height: 480 });

    const second = createWindowState({ file, displays: () => [laptop] });

    expect(second.boundsFor("w1")).toEqual({ x: 100, y: 120, width: 800, height: 600 });
    expect(second.boundsFor("w2")).toEqual({ x: 300, y: 200, width: 640, height: 480 });
  });

  it("forgets a window it is told to, so the file does not collect windows that are gone", () => {
    const state = createWindowState({ file, displays: () => [laptop] });
    state.remember("w1", { x: 100, y: 120, width: 800, height: 600 });
    state.remember("w2", { x: 300, y: 200, width: 640, height: 480 });

    state.forget("w1");

    const reread = createWindowState({ file, displays: () => [laptop] });
    expect(reread.boundsFor("w1")).toBeUndefined();
    expect(reread.boundsFor("w2")).toBeDefined();
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf-8")).windows)).toEqual(["w2"]);
  });

  it.each([
    ["not JSON", "{{{"],
    ["not an object", "[]"],
    ["no windows", "{}"],
    ["windows of the wrong kind", '{"windows": 7}'],
  ])("starts afresh when the file is %s", (_name, contents) => {
    fs.writeFileSync(file, contents);
    const state = createWindowState({ file, displays: () => [laptop] });

    expect(state.boundsFor("w1")).toBeUndefined();
    state.remember("w1", { x: 0, y: 25, width: 500, height: 400 });
    expect(createWindowState({ file, displays: () => [laptop] }).boundsFor("w1")).toBeDefined();
  });

  it("ignores an entry that is not a window's bounds, and keeps the others", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        windows: {
          w1: { x: 10, y: 30, width: 500, height: 400 },
          w2: { x: "left", y: 0, width: 500, height: 400 },
          w3: { x: 0, y: 0, width: -5, height: 400 },
          w4: { x: 0, y: 0, width: 500 },
          w5: null,
        },
      }),
    );
    const state = createWindowState({ file, displays: () => [laptop] });

    expect(state.boundsFor("w1")).toEqual({ x: 10, y: 30, width: 500, height: 400 });
    for (const id of ["w2", "w3", "w4", "w5"]) expect(state.boundsFor(id), id).toBeUndefined();
  });

  it("leaves bounds that are on a display as they were", () => {
    const state = createWindowState({ file, displays: () => [laptop, monitor] });
    state.remember("w1", { x: 1500, y: 100, width: 800, height: 600 });

    expect(state.boundsFor("w1")).toEqual({ x: 1500, y: 100, width: 800, height: 600 });
  });

  it("brings a window back onto a display when the one it was on has gone", () => {
    const withMonitor = createWindowState({ file, displays: () => [laptop, monitor] });
    withMonitor.remember("w1", { x: 2000, y: 200, width: 800, height: 600 });

    const laptopOnly = createWindowState({ file, displays: () => [laptop] });

    // The size is kept; it moves in just far enough to be wholly on the display.
    expect(laptopOnly.boundsFor("w1")).toEqual({ x: 640, y: 200, width: 800, height: 600 });
  });

  it("brings in a window that hangs over the edge of a display, onto the display it is mostly on", () => {
    const state = createWindowState({ file, displays: () => [laptop, monitor] });
    state.remember("w1", { x: 1300, y: 100, width: 800, height: 600 }); // 140 px on the laptop, 660 on the monitor

    expect(state.boundsFor("w1")).toEqual({ x: 1440, y: 100, width: 800, height: 600 });
  });

  it("shrinks a window that is larger than the display it has to be on", () => {
    const state = createWindowState({ file, displays: () => [laptop] });
    state.remember("w1", { x: 0, y: 25, width: 3000, height: 2000 });

    expect(state.boundsFor("w1")).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });

  it("brings in a window that is wholly off every display, onto the first one", () => {
    const state = createWindowState({ file, displays: () => [laptop] });
    state.remember("w1", { x: -5000, y: -5000, width: 800, height: 600 });

    expect(state.boundsFor("w1")).toEqual({ x: 0, y: 25, width: 800, height: 600 });
  });

  it("gives a window's bounds as they were when it is told of no displays at all", () => {
    const state = createWindowState({ file, displays: () => [] });
    state.remember("w1", { x: 50, y: 60, width: 800, height: 600 });

    expect(state.boundsFor("w1")).toEqual({ x: 50, y: 60, width: 800, height: 600 });
  });

  it("does not fail when the file cannot be written", () => {
    const state = createWindowState({ file: path.join(dir, "missing", "deeper", "state.json").replace("missing", "file.txt"), displays: () => [laptop] });
    fs.writeFileSync(path.join(dir, "file.txt"), "a file where a folder should be");

    expect(() => state.remember("w1", { x: 0, y: 25, width: 500, height: 400 })).not.toThrow();
    expect(state.boundsFor("w1")).toEqual({ x: 0, y: 25, width: 500, height: 400 });
  });
});
