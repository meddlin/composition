// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsHelper, useShortcutsHelper } from "./ShortcutsHelper";
import { SHORTCUT_GROUPS } from "./shortcuts";

afterEach(cleanup);

const dialog = () => screen.queryByRole("dialog", { name: "Keyboard shortcuts" });

describe("ShortcutsHelper", () => {
  it.each([
    ["Cmd+/", { metaKey: true }],
    ["Ctrl+/", { ctrlKey: true }],
  ])("%s opens the window and a second press closes it", (_label, modifier) => {
    render(<ShortcutsHelper />);
    expect(dialog()).toBeNull();

    expect(fireEvent.keyDown(document.body, { key: "/", ...modifier })).toBe(false);
    expect(dialog()).not.toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "/", ...modifier });
    expect(dialog()).toBeNull();
  });

  it("opens on a bare ? but not while typing in a field", () => {
    render(
      <ShortcutsHelper>
        <textarea aria-label="Note" />
      </ShortcutsHelper>,
    );

    fireEvent.keyDown(screen.getByLabelText("Note"), { key: "?" });
    expect(dialog()).toBeNull();

    fireEvent.keyDown(document.body, { key: "?" });
    expect(dialog()).not.toBeNull();
  });

  it("ignores other keys, other modifiers, and held-down repeats", () => {
    render(<ShortcutsHelper />);
    fireEvent.keyDown(document.body, { key: "/" });
    fireEvent.keyDown(document.body, { key: "/", metaKey: true, altKey: true });
    fireEvent.keyDown(document.body, { key: "/", metaKey: true, repeat: true });
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(dialog()).toBeNull();
  });

  it("closes on Escape", () => {
    render(<ShortcutsHelper />);
    fireEvent.keyDown(document.body, { key: "?" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(dialog()).toBeNull();
  });

  it("can be opened from elsewhere in the app", () => {
    function Opener() {
      return <button onClick={useShortcutsHelper().show}>Open</button>;
    }
    render(
      <ShortcutsHelper>
        <Opener />
      </ShortcutsHelper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(dialog()).not.toBeNull();
  });

  it("lists highlight and search, plus every group", () => {
    render(<ShortcutsHelper />);
    fireEvent.keyDown(document.body, { key: "?" });
    const list = screen.getByRole("dialog");

    expect(list.textContent).toContain("Search notes");
    expect(list.textContent).toContain("Highlight the selection");
    for (const group of SHORTCUT_GROUPS) {
      expect(screen.getByRole("region", { name: group.title })).toBeTruthy();
    }
  });

  it("writes Mod as Ctrl off macOS", () => {
    render(<ShortcutsHelper />);
    fireEvent.keyDown(document.body, { key: "?" });
    const search = screen.getByText("Search notes").closest("div");
    expect([...search!.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "K"]);
  });
});
