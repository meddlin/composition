import { describe, expect, it } from "vitest";
import { appMenuIndex, insertionIndex } from "./appMenu";

describe("appMenuIndex", () => {
  const linuxMenus = [{ role: "fileMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }, { role: "help" }];

  it("is the application menu, the first, on macOS", () => {
    expect(appMenuIndex([{ role: "appMenu" }, { role: "fileMenu" }], "darwin")).toBe(0);
    expect(appMenuIndex([], "darwin")).toBe(-1);
  });

  it("is the Help menu on Linux", () => {
    expect(appMenuIndex(linuxMenus, "linux")).toBe(4);
  });

  it("is none on Linux without a Help menu, and on other platforms", () => {
    expect(appMenuIndex(linuxMenus.slice(0, 4), "linux")).toBe(-1);
    expect(appMenuIndex(linuxMenus, "win32")).toBe(-1);
  });
});

describe("insertionIndex", () => {
  const mac = [{ role: "about" }, { role: "services" }, { role: "quit" }];

  it("goes after About on macOS", () => {
    expect(insertionIndex(mac, "darwin")).toBe(1);
  });

  it("goes after the item named, when it is there", () => {
    const withUpdates = [{ role: "about" }, { label: "Check for Updates…" }, { role: "quit" }];

    expect(insertionIndex(withUpdates, "darwin", "Check for Updates…")).toBe(2);
    expect(insertionIndex([{ label: "Learn More" }, { label: "Check for Updates…" }], "linux", "Check for Updates…")).toBe(2);
  });

  it("goes last in the Help menu on Linux", () => {
    expect(insertionIndex([{ label: "Learn More" }, { label: "Documentation" }], "linux")).toBe(2);
    expect(insertionIndex([], "linux")).toBe(0);
  });
});
