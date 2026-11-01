import { describe, expect, it, vi } from "vitest";
import { READING_LIST_PARTITION } from "../../../web/src/lib/composition/readingListApi";
import { appShortcutKey, clearReadingData, guardWebviewAttach, installReadingListGuard, secureReadingSession, type SessionLike } from "./readingListGuard";

const hostile = () => ({
  webPreferences: {
    preload: "/evil/preload.js",
    preloadURL: "file:///evil/preload.js",
    nodeIntegration: true,
    nodeIntegrationInSubFrames: true,
    contextIsolation: false,
    sandbox: false,
    webSecurity: false,
    allowRunningInsecureContent: true,
    enableBlinkFeatures: "Anything",
  } as Record<string, unknown>,
  params: { src: "https://example.com/a", partition: READING_LIST_PARTITION, allowpopups: "true", nodeintegration: "true", preload: "/evil.js", webpreferences: "sandbox=no" } as Record<string, unknown>,
});

describe("guardWebviewAttach", () => {
  it("forces the guest's isolation and partition whatever the page asked for", () => {
    const { webPreferences, params } = hostile();

    expect(guardWebviewAttach(webPreferences, params, true)).toBe(true);

    expect(webPreferences).toMatchObject({ nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false });
    expect(webPreferences).not.toHaveProperty("preload");
    expect(webPreferences).not.toHaveProperty("preloadURL");
    expect(webPreferences).not.toHaveProperty("enableBlinkFeatures");
    // Nothing but the address and the partition survives from the page's own attributes: no preload, no node. (Popups are on only so the open handler hears of them; it denies every one.)
    expect(params).toEqual({ src: "https://example.com/a", partition: READING_LIST_PARTITION, allowpopups: "true" });
  });

  it("refuses to attach while the plugin is off", () => {
    const { webPreferences, params } = hostile();
    expect(guardWebviewAttach(webPreferences, params, false)).toBe(false);
  });

  it.each([["file:///etc/passwd"], ["app://composition/"], ["javascript:alert(1)"], ["data:text/html,hi"], ["about:blank"], [""], [undefined], [42]])("refuses a src of %j", (src) => {
    const { webPreferences, params } = hostile();
    params.src = src;
    expect(guardWebviewAttach(webPreferences, params, true)).toBe(false);
  });

  it.each([["persist:composition"], ["persist:forged"], ["reading-list"], [""], [undefined]])("refuses a view in the partition %j, since Electron has already put it there", (partition) => {
    const { webPreferences, params } = hostile();
    params.partition = partition;
    expect(guardWebviewAttach(webPreferences, params, true)).toBe(false);
  });

  it("accepts http as well as https", () => {
    const { webPreferences, params } = hostile();
    params.src = "http://127.0.0.1:8080/";
    expect(guardWebviewAttach(webPreferences, params, true)).toBe(true);
  });
});

describe("appShortcutKey", () => {
  const press = (over: Record<string, unknown>) => ({ type: "keyDown", code: "KeyW", shift: true, meta: true, control: false, alt: false, ...over });

  it("recognises the panel keys with Cmd and Shift on macOS, and with Ctrl and Shift elsewhere", () => {
    expect(appShortcutKey(press({}), "darwin")).toBe("W");
    expect(appShortcutKey(press({ code: "Backslash" }), "darwin")).toBe("\\");
    expect(appShortcutKey(press({ code: "KeyP" }), "darwin")).toBe("P");
    expect(appShortcutKey(press({ code: "BracketRight" }), "darwin")).toBe("]");
    expect(appShortcutKey(press({ code: "BracketLeft" }), "darwin")).toBe("[");
    expect(appShortcutKey(press({ meta: false, control: true }), "linux")).toBe("W");
  });

  it("leaves every other key to the page", () => {
    expect(appShortcutKey(press({ shift: false }), "darwin")).toBeNull();
    expect(appShortcutKey(press({ meta: false }), "darwin")).toBeNull();
    expect(appShortcutKey(press({ control: true, meta: false }), "darwin")).toBeNull();
    expect(appShortcutKey(press({ alt: true }), "darwin")).toBeNull();
    expect(appShortcutKey(press({ isAutoRepeat: true }), "darwin")).toBeNull();
    expect(appShortcutKey(press({ type: "keyUp" }), "darwin")).toBeNull();
    expect(appShortcutKey(press({ code: "KeyA" }), "darwin")).toBeNull();
  });
});

type Handler = (...args: any[]) => any;

function fakeContents() {
  const handlers = new Map<string, Handler>();
  const contents = {
    on: (event: string, handler: Handler) => void handlers.set(event, handler),
    setWindowOpenHandler: vi.fn(),
    hostWebContents: { sendInputEvent: vi.fn() },
  };
  return { contents, handlers };
}

function fakeSession() {
  const handlers = new Map<string, Handler>();
  const session = {
    setPermissionRequestHandler: vi.fn((handler: Handler) => void handlers.set("request", handler)),
    setPermissionCheckHandler: vi.fn((handler: Handler) => void handlers.set("check", handler)),
    setDevicePermissionHandler: vi.fn((handler: Handler) => void handlers.set("device", handler)),
    on: vi.fn((event: string, handler: Handler) => void handlers.set(event, handler)),
    clearStorageData: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
  };
  return { session: session satisfies SessionLike, handlers };
}

function setup(over: { enabled?: boolean; platform?: string } = {}) {
  const { contents: host, handlers: hostHandlers } = fakeContents();
  const { session } = fakeSession();
  const deps = { pluginEnabled: vi.fn(() => over.enabled ?? true), openExternal: vi.fn(), readingSession: () => session };
  installReadingListGuard(host, deps, over.platform ?? "darwin");
  const attach = (params: Record<string, unknown>, webPreferences: Record<string, unknown> = {}) => {
    const event = { preventDefault: vi.fn() };
    hostHandlers.get("will-attach-webview")!(event, webPreferences, params);
    return event;
  };
  const guestAttached = () => {
    const guest = fakeContents();
    hostHandlers.get("did-attach-webview")!({}, guest.contents);
    return guest;
  };
  return { host, deps, session, attach, guestAttached };
}

describe("installReadingListGuard", () => {
  it("lets a web page attach while the plugin is on, and refuses a file page", () => {
    const { attach } = setup();
    expect(attach({ src: "https://example.com/", partition: READING_LIST_PARTITION }).preventDefault).not.toHaveBeenCalled();
    expect(attach({ src: "file:///etc/passwd", partition: READING_LIST_PARTITION }).preventDefault).toHaveBeenCalled();
  });

  it("refuses every attach while the plugin is off, and reads the switch at each attach", () => {
    const { attach, deps } = setup({ enabled: false });
    const params = { src: "https://example.com/", partition: READING_LIST_PARTITION };
    expect(attach({ ...params }).preventDefault).toHaveBeenCalled();
    deps.pluginEnabled.mockReturnValue(true);
    expect(attach({ ...params }).preventDefault).not.toHaveBeenCalled();
    expect(deps.pluginEnabled).toHaveBeenCalledTimes(2);
  });

  it("denies every permission in the pages' session, and downloads", () => {
    const { attach, session } = setup();
    attach({ src: "https://example.com/", partition: READING_LIST_PARTITION });

    const request = vi.mocked(session.setPermissionRequestHandler).mock.calls[0][0];
    const callback = vi.fn();
    request({}, "geolocation", callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(vi.mocked(session.setPermissionCheckHandler).mock.calls[0][0]()).toBe(false);
    expect(vi.mocked(session.setDevicePermissionHandler!).mock.calls[0][0]()).toBe(false);
    const download = { preventDefault: vi.fn() };
    vi.mocked(session.on).mock.calls.find(([event]) => event === "will-download")![1](download);
    expect(download.preventDefault).toHaveBeenCalled();
  });

  it("sends a new-window request to the browser, and opens no window of ours", () => {
    const { guestAttached, deps } = setup();
    const { contents } = guestAttached();
    const decide = contents.setWindowOpenHandler.mock.calls[0][0];

    expect(decide({ url: "https://example.com/out" })).toEqual({ action: "deny" });
    expect(decide({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(deps.openExternal).toHaveBeenCalledTimes(1);
    expect(deps.openExternal).toHaveBeenCalledWith("https://example.com/out");
  });

  it("keeps the view on web pages: a navigation or redirect to app://, file:// or javascript: is stopped, and a web one is not", () => {
    const { guestAttached } = setup();
    const { handlers } = guestAttached();
    for (const kind of ["will-navigate", "will-redirect"]) {
      for (const url of ["app://composition/", "file:///etc/passwd", "javascript:alert(1)"]) {
        const event = { preventDefault: vi.fn() };
        handlers.get(kind)!(event, url);
        expect(event.preventDefault, `${kind} ${url}`).toHaveBeenCalled();
      }
      const ok = { preventDefault: vi.fn() };
      handlers.get(kind)!(ok, "https://example.com/next");
      expect(ok.preventDefault).not.toHaveBeenCalled();
    }
  });

  it("hands the app's panel keys on to the page that holds the view, and leaves other keys to the guest", () => {
    const { guestAttached } = setup();
    const { handlers, contents } = guestAttached();

    const owned = { preventDefault: vi.fn() };
    handlers.get("before-input-event")!(owned, { type: "keyDown", code: "KeyW", shift: true, meta: true });
    expect(owned.preventDefault).toHaveBeenCalled();
    expect(contents.hostWebContents.sendInputEvent).toHaveBeenCalledWith({ type: "keyDown", keyCode: "W", modifiers: ["meta", "shift"] });
    expect(contents.hostWebContents.sendInputEvent).toHaveBeenCalledWith({ type: "keyUp", keyCode: "W", modifiers: ["meta", "shift"] });

    const typed = { preventDefault: vi.fn() };
    handlers.get("before-input-event")!(typed, { type: "keyDown", code: "KeyW", shift: false, meta: false });
    expect(typed.preventDefault).not.toHaveBeenCalled();
  });
});

describe("clearReadingData", () => {
  it("wipes the session's storage and cache", async () => {
    const { session } = fakeSession();
    await clearReadingData(session);
    expect(session.clearStorageData).toHaveBeenCalled();
    expect(session.clearCache).toHaveBeenCalled();
  });
});

describe("secureReadingSession", () => {
  it("can be applied again without harm", () => {
    const { session } = fakeSession();
    secureReadingSession(session);
    secureReadingSession(session);
    expect(session.setPermissionCheckHandler).toHaveBeenCalledTimes(2);
  });
});
