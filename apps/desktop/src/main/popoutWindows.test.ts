import { describe, expect, it } from "vitest";
import { decideWindowOpen, POPOUT_PATH } from "./popoutWindows";

const OWN = "app://composition";
const base = {
  url: `${OWN}${POPOUT_PATH}?w=w1`,
  openedByPopout: false,
  allowedOrigins: [OWN],
  preloadPath: "/app/preload.js",
  backgroundColor: "#121212",
  translucent: false,
};

describe("decideWindowOpen", () => {
  it("lets the main window open the pop-out page, in a window with the same isolation as its own", () => {
    const decision = decideWindowOpen(base);

    expect(decision).toMatchObject({ action: "allow", windowId: "w1" });
    if (decision.action !== "allow") throw new Error("not allowed");
    expect(decision.options.webPreferences).toEqual({
      preload: "/app/preload.js",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      webviewTag: true,
    });
    expect(decision.options).toMatchObject({ show: false, backgroundColor: "#121212", title: "Composition" });
  });

  it("makes the window see-through, as the main window is, when the see-through look is on (macOS), and solid when it is off", () => {
    const see = decideWindowOpen({ ...base, translucent: true });
    const solid = decideWindowOpen({ ...base, translucent: false });
    if (see.action !== "allow" || solid.action !== "allow") throw new Error("not allowed");

    expect(see.options.vibrancy).toBe("under-window");
    expect(solid.options).not.toHaveProperty("vibrancy");
  });

  it("puts the window where it was last, when that is known, and in a default place and size when not", () => {
    const placed = decideWindowOpen({ ...base, bounds: { x: 40, y: 60, width: 700, height: 500 } });
    const unplaced = decideWindowOpen(base);

    if (placed.action !== "allow" || unplaced.action !== "allow") throw new Error("not allowed");
    expect(placed.options).toMatchObject({ x: 40, y: 60, width: 700, height: 500 });
    expect(unplaced.options).toMatchObject({ width: 900, height: 700 });
    expect(unplaced.options).not.toHaveProperty("x");
  });

  it("allows it from the development server's origin too, when there is one", () => {
    const decision = decideWindowOpen({
      ...base,
      url: `http://localhost:3000${POPOUT_PATH}?w=w12`,
      allowedOrigins: [OWN, "http://localhost:3000"],
    });

    expect(decision).toMatchObject({ action: "allow", windowId: "w12" });
  });

  it.each([
    ["another page of the app", `${OWN}/settings/?w=w1`],
    ["the workspace", `${OWN}/`],
    ["the pop-out page without its trailing slash", `${OWN}/popout?w=w1`],
    ["a path inside it", `${OWN}${POPOUT_PATH}extra/?w=w1`],
    ["no window id", `${OWN}${POPOUT_PATH}`],
    ["an empty window id", `${OWN}${POPOUT_PATH}?w=`],
    ["the main window's id", `${OWN}${POPOUT_PATH}?w=main`],
    ["an id that is not a pop-out's", `${OWN}${POPOUT_PATH}?w=w1x`],
    ["an uppercase id", `${OWN}${POPOUT_PATH}?w=W1`],
    ["an id with no number", `${OWN}${POPOUT_PATH}?w=w`],
    ["a second window id", `${OWN}${POPOUT_PATH}?w=w1&w=w2`],
    ["a parameter it does not know", `${OWN}${POPOUT_PATH}?w=w1&next=/settings/`],
    ["a lookalike origin", `app://composition.evil.example${POPOUT_PATH}?w=w1`],
    ["something that is not a URL", "not a url"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a file: URL", "file:///etc/passwd"],
  ])("refuses %s, without opening anything outside the app", (_name, url) => {
    expect(decideWindowOpen({ ...base, url })).toEqual({ action: "deny" });
  });

  it("treats the pop-out's URL on any other origin as the ordinary link it is: for the browser, never a window of ours", () => {
    const url = `https://evil.example${POPOUT_PATH}?w=w1`;

    expect(decideWindowOpen({ ...base, url })).toEqual({ action: "deny", openExternally: url });
  });

  it("refuses to let a pop-out open another pop-out", () => {
    expect(decideWindowOpen({ ...base, openedByPopout: true })).toEqual({ action: "deny" });
  });

  it.each([
    ["https://example.com/a?b=1"],
    ["http://example.com/"],
    ["mailto:someone@example.com"],
  ])("sends %s to the browser instead of opening a window, from either kind of window", (url) => {
    expect(decideWindowOpen({ ...base, url })).toEqual({ action: "deny", openExternally: url });
    expect(decideWindowOpen({ ...base, url, openedByPopout: true })).toEqual({ action: "deny", openExternally: url });
  });
});
