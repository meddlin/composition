import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POPOUT_CLOSED_CHANNEL } from "../shared/channels";
import { createPopoutManager, type WindowLike } from "./popoutManager";
import { POPOUT_PATH, type Bounds, type WindowOpenDecision } from "./popoutWindows";
import type { WindowState } from "./windowState";

const OWN = "app://composition";
const popoutUrl = (id: string) => `${OWN}${POPOUT_PATH}?w=${id}`;

type OpenHandler = (details: { url: string }) => { action: string; overrideBrowserWindowOptions?: Record<string, unknown> };

/** A window as far as the manager touches one. */
function fakeWindow(bounds: Bounds = { x: 100, y: 100, width: 900, height: 700 }) {
  const webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    openHandler: undefined as OpenHandler | undefined,
    setWindowOpenHandler(handler: OpenHandler) {
      this.openHandler = handler;
    },
  });
  const window = Object.assign(new EventEmitter(), {
    webContents,
    bounds,
    destroyed: false,
    show: vi.fn(),
    destroy: vi.fn(function (this: { destroyed: boolean; emit: (event: string) => boolean }) {
      this.destroyed = true;
      this.emit("closed");
    }),
    isDestroyed() {
      return this.destroyed;
    },
    getBounds() {
      return this.bounds;
    },
  });
  return window;
}
type FakeWindow = ReturnType<typeof fakeWindow>;

function fakeState(known: Record<string, Bounds> = {}) {
  const remembered = new Map(Object.entries(known));
  const state: WindowState = {
    boundsFor: (id) => remembered.get(id),
    remember: vi.fn((id, bounds) => void remembered.set(id, bounds)),
    forget: vi.fn((id) => void remembered.delete(id)),
  };
  return state;
}

function setup(known: Record<string, Bounds> = {}, translucent = false) {
  const main = fakeWindow({ x: 200, y: 150, width: 1280, height: 820 });
  const state = fakeState(known);
  const openExternal = vi.fn();
  const installContextMenu = vi.fn();
  const installReadingListGuard = vi.fn();
  const manager = createPopoutManager({
    allowedOrigins: [OWN],
    preloadPath: "/app/preload.js",
    backgroundColor: () => "#121212",
    translucent: () => translucent,
    windowState: state,
    openExternal,
    installContextMenu,
    installReadingListGuard,
  });
  manager.attach(main as unknown as WindowLike);

  /** What the main window's page asking for `url` gets, and (if it was let through) the window that results. */
  function open(id: string, from: FakeWindow = main) {
    const decision = from.webContents.openHandler!({ url: popoutUrl(id) }) as WindowOpenDecision & { overrideBrowserWindowOptions?: Record<string, unknown> };
    const child = fakeWindow({ x: 0, y: 0, width: 900, height: 700 });
    if (decision.action === "allow") from.webContents.emit("did-create-window", child, { url: popoutUrl(id) });
    return { decision, child };
  }
  return { main, state, openExternal, installContextMenu, installReadingListGuard, manager, open };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the main window's rule for opening windows", () => {
  it("lets its page open a pop-out, where that pop-out was last", () => {
    const { open } = setup({ w1: { x: 40, y: 60, width: 700, height: 500 } });

    const { decision } = open("w1");

    expect(decision.action).toBe("allow");
    expect((decision as { overrideBrowserWindowOptions: Record<string, unknown> }).overrideBrowserWindowOptions).toMatchObject({
      x: 40,
      y: 60,
      width: 700,
      height: 500,
    });
  });

  it("opens a pop-out see-through when the windows are, and solid when they are not", () => {
    const options = (translucent: boolean) =>
      (setup({}, translucent).open("w1").decision as { overrideBrowserWindowOptions: Record<string, unknown> }).overrideBrowserWindowOptions;

    expect(options(true)).toMatchObject({ vibrancy: "under-window" });
    expect(options(false)).not.toHaveProperty("vibrancy");
  });

  it("puts a pop-out it has not seen before beside the main window, each one a little further along", () => {
    const { open } = setup();

    const first = open("w1");
    const second = open("w2");

    expect((first.decision as { overrideBrowserWindowOptions: Record<string, unknown> }).overrideBrowserWindowOptions).toMatchObject({ x: 240, y: 190 });
    expect((second.decision as { overrideBrowserWindowOptions: Record<string, unknown> }).overrideBrowserWindowOptions).toMatchObject({ x: 270, y: 220 });
  });

  it("refuses any other window, and sends ordinary links to the browser", () => {
    const { main, openExternal } = setup();

    expect(main.webContents.openHandler!({ url: `${OWN}/settings/` })).toEqual({ action: "deny" });
    expect(main.webContents.openHandler!({ url: "https://example.com/" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});

describe("a pop-out that was opened", () => {
  it("gets the context menu, and is shown once it is ready", () => {
    const { open, installContextMenu, installReadingListGuard } = setup();

    const { child } = open("w1");

    expect(installContextMenu).toHaveBeenCalledWith(child.webContents);
    // A pop-out can hold a Reading List web view, so it gets the same guard as the main window.
    expect(installReadingListGuard).toHaveBeenCalledWith(child.webContents);
    expect(child.show).not.toHaveBeenCalled();
    child.emit("ready-to-show");
    expect(child.show).toHaveBeenCalledTimes(1);
  });

  it("cannot open windows of its own, though its links still go to the browser", () => {
    const { open, openExternal } = setup();
    const { child } = open("w1");

    expect(child.webContents.openHandler!({ url: popoutUrl("w2") })).toEqual({ action: "deny" });
    expect(child.webContents.openHandler!({ url: "https://example.com/x" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/x");
  });

  it("never navigates away from the app: an outside address is stopped and sent to the browser", () => {
    const { open, openExternal } = setup();
    const { child } = open("w1");
    const stop = vi.fn();

    child.webContents.emit("will-navigate", { preventDefault: stop }, "https://example.com/");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");

    child.webContents.emit("will-navigate", { preventDefault: stop }, `${OWN}/popout/?w=w1`);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("is remembered where it is put, once it has stopped moving and not at every step", () => {
    const { open, state } = setup();
    const { child } = open("w1");
    child.bounds = { x: 10, y: 20, width: 800, height: 600 };

    child.emit("move");
    child.emit("resize");
    child.emit("move");
    expect(state.remember).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);

    expect(state.remember).toHaveBeenCalledTimes(1);
    expect(state.remember).toHaveBeenCalledWith("w1", { x: 10, y: 20, width: 800, height: 600 });
  });

  it("is forgotten when the user closes it, so the file does not collect windows that are gone", () => {
    const { open, state } = setup();
    const { child } = open("w1");

    child.emit("closed");

    expect(state.forget).toHaveBeenCalledWith("w1");
  });

  it("is reported to the main window's page when the user closes it, which is how the workspace learns of it", () => {
    const { main, open } = setup();
    const { child } = open("w1");

    child.emit("closed");

    expect(main.webContents.send).toHaveBeenCalledWith(POPOUT_CLOSED_CHANNEL, "w1");
  });

  it("is not reported when the app destroys it, since the workspace must keep it for the next launch", () => {
    const { main, open } = setup();
    open("w1");
    open("w2");

    main.emit("close");

    expect(main.webContents.send).not.toHaveBeenCalled();
  });

  it("is not reported to a main window that is gone", () => {
    const { main, open } = setup();
    const { child } = open("w1");
    main.destroyed = true;

    child.emit("closed");

    expect(main.webContents.send).not.toHaveBeenCalled();
  });
});

describe("pop-outs when the main window goes", () => {
  it("are destroyed, not closed, when it closes, and keep their places and the saved layout", () => {
    const { main, open, state } = setup();
    const { child: one } = open("w1");
    const { child: two } = open("w2");

    main.emit("closed");

    expect(one.destroy).toHaveBeenCalled();
    expect(two.destroy).toHaveBeenCalled();
    // Destroyed by the app, not closed by the user: nothing is forgotten, so they come back with the main window.
    expect(state.forget).not.toHaveBeenCalled();
  });

  it("are destroyed as soon as it starts to close, before they are asked to close themselves, so they come back with it", () => {
    const { main, open, state } = setup();
    const { child } = open("w1");

    main.emit("close");

    expect(child.destroy).toHaveBeenCalledTimes(1);
    expect(state.forget).not.toHaveBeenCalled();
  });

  it("can be destroyed all at once by the app, as it quits", () => {
    const { manager, open, state } = setup();
    const { child: one } = open("w1");
    const { child: two } = open("w2");

    manager.destroyAll();

    expect(one.destroy).toHaveBeenCalledTimes(1);
    expect(two.destroy).toHaveBeenCalledTimes(1);
    expect(state.forget).not.toHaveBeenCalled();
  });

  it("are destroyed when its page is navigated away from, which loses the workspace they are showing", () => {
    const { main, open } = setup();
    const { child } = open("w1");

    main.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });

    expect(child.destroy).toHaveBeenCalled();
  });

  it("stay open through navigation inside the page (Settings), and one in a frame of it", () => {
    const { main, open } = setup();
    const { child } = open("w1");

    main.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    main.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });

    expect(child.destroy).not.toHaveBeenCalled();
  });

  it("are not touched by one pop-out navigating, or by one pop-out closing", () => {
    const { open } = setup();
    const { child: one } = open("w1");
    const { child: two } = open("w2");

    one.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    one.emit("closed");

    expect(two.destroy).not.toHaveBeenCalled();
  });

  it("are not destroyed twice, nor is one that has closed already", () => {
    const { main, open } = setup();
    const { child: one } = open("w1");
    const { child: two } = open("w2");
    two.emit("closed");
    two.destroyed = true;

    main.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    main.emit("closed");

    expect(one.destroy).toHaveBeenCalledTimes(1);
    expect(two.destroy).not.toHaveBeenCalled();
  });
});
