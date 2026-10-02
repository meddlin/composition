import { defaultTextareaKeyBindings } from "@opentui/core";
import { describe, expect, it } from "vitest";
import { actionFor, BINDINGS, bindingsFor, footerFor, keyId, type Scope } from "./keymap";

const SCOPES: Scope[] = ["tree", "pane", "trash", "settings"];

describe("keyId", () => {
  it.each([
    [{ name: "n", ctrl: true }, "ctrl+n"],
    [{ name: "return" }, "enter"],
    [{ name: "escape" }, "escape"],
    [{ name: "space", ctrl: true }, "ctrl+space"],
    [{ name: "left", meta: true }, "alt+left"],
    [{ name: "?" }, "?"],
    [{ name: "/" }, "/"],
    [{ name: "z", ctrl: true, shift: true }, "ctrl+shift+z"],
  ])("names %j %s", (key, expected) => {
    expect(keyId(key)).toBe(expected);
  });
});

describe("actionFor", () => {
  it("finds the action a key triggers in a scope", () => {
    expect(actionFor("tree", { name: "n", ctrl: true })).toBe("new-note");
    expect(actionFor("tree", { name: "/" })).toBe("search");
    expect(actionFor("tree", { name: "space", ctrl: true })).toBe("search");
    expect(actionFor("pane", { name: "o", ctrl: true })).toBe("next-pane");
    expect(actionFor("tree", { name: "o", ctrl: true })).toBe("next-pane");
    expect(actionFor("pane", { name: "t", ctrl: true })).toBe("cycle-view");
    expect(actionFor("pane", { name: "x", ctrl: true })).toBe("close-pane");
    expect(actionFor("pane", { name: "escape" })).toBe("to-tree");
    expect(actionFor("trash", { name: "r" })).toBe("restore");
  });

  it("gives the same key different jobs in different scopes", () => {
    expect(actionFor("tree", { name: "d", ctrl: true })).toBe("delete");
    expect(actionFor("trash", { name: "d", ctrl: true })).toBe("delete-forever");
    expect(actionFor("tree", { name: "r" })).toBe("rename-group");
    expect(actionFor("trash", { name: "r" })).toBe("restore");
  });

  it("does not turn plain typing in the editor into an app action", () => {
    for (const letter of ["q", "o", "m", "r", "f", "/", "?"]) {
      expect(actionFor("pane", { name: letter })).toBeUndefined();
    }
  });
});

describe("the list itself", () => {
  it("binds no key twice in one scope", () => {
    for (const scope of SCOPES) {
      const keys = bindingsFor(scope).flatMap((binding) => binding.keys);
      expect(new Set(keys).size, `duplicate key in ${scope}`).toBe(keys.length);
    }
  });

  it("never takes a key the text editor uses while a pane has focus", () => {
    const editorOwns = new Set(
      defaultTextareaKeyBindings.map((binding) =>
        keyId({ name: binding.name, ctrl: binding.ctrl, meta: binding.meta, shift: binding.shift }),
      ),
    );
    // Our own remapping of undo and redo (see docs/ui/cli-keybindings.md).
    editorOwns.add("ctrl+z").add("ctrl+y");

    for (const binding of bindingsFor("pane")) {
      for (const key of binding.keys) {
        // Esc is how you leave the editor, and the editor has no use for it.
        if (key === "escape") continue;
        expect(editorOwns.has(key), `${key} belongs to the editor`).toBe(false);
      }
    }
  });

  it("never uses a key the operating system or the terminal keeps", () => {
    const forbidden = (key: string) =>
      /^(ctrl|alt)\+(left|right)$/.test(key) || // Mission Control; also the editor's word moves
      /^(ctrl|alt)\+\d$/.test(key) || // desktops; symbols in Terminal.app
      key.includes("shift+") || // legacy terminals can't tell ctrl+shift+x from ctrl+x
      key === "ctrl+c"; // quits the app
    for (const binding of BINDINGS) {
      for (const key of binding.keys) expect(forbidden(key), `${key} must not be bound`).toBe(false);
    }
  });

  it("explains every binding", () => {
    for (const binding of BINDINGS) {
      expect(binding.hint.length).toBeGreaterThan(0);
      expect(binding.description.length).toBeGreaterThan(0);
    }
  });
});

describe("footerFor", () => {
  it("lists the footer hints for a scope", () => {
    const tree = footerFor("tree");
    expect(tree).toContain("ctrl+n note");
    expect(tree).toContain("q quit");
    expect(tree).not.toContain("ctrl+o");
    expect(footerFor("pane")).toContain("ctrl+o next pane");
  });
});
