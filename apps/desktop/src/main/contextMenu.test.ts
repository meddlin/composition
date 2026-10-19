import { describe, expect, it, vi } from "vitest";

// contextMenu.ts imports Electron, which only exists inside the app; the template is all these tests need.
vi.mock("electron", () => ({ Menu: {} }));

import { contextMenuTemplate } from "./contextMenu";

const noEdits = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false };
const field = { isEditable: true, misspelledWord: "", dictionarySuggestions: [], selectionText: "", editFlags: { ...noEdits, canPaste: true, canSelectAll: true } };

function actions() {
  return { replaceMisspelling: vi.fn(), addToDictionary: vi.fn() };
}

describe("contextMenuTemplate", () => {
  it("offers corrections and Add to Dictionary on a misspelled word", () => {
    const a = actions();
    const menu = contextMenuTemplate({ ...field, misspelledWord: "teh", dictionarySuggestions: ["the", "tea", "ten"] }, a);

    expect(menu.slice(0, 3).map((item) => item.label)).toEqual(["the", "tea", "ten"]);
    const add = menu.find((item) => item.label === "Add to Dictionary");
    expect(add).toBeDefined();

    menu[1].click?.(undefined as never, undefined, undefined as never);
    expect(a.replaceMisspelling).toHaveBeenCalledWith("tea");
    add!.click?.(undefined as never, undefined, undefined as never);
    expect(a.addToDictionary).toHaveBeenCalledWith("teh");
  });

  it("caps the suggestions", () => {
    const menu = contextMenuTemplate(
      { ...field, misspelledWord: "wrd", dictionarySuggestions: ["a", "b", "c", "d", "e", "f", "g"] },
      actions(),
    );
    expect(menu.filter((item) => item.click && item.label !== "Add to Dictionary")).toHaveLength(5);
  });

  it("says so when there are no suggestions, and still lets the word be added", () => {
    const menu = contextMenuTemplate({ ...field, misspelledWord: "zzxqv" }, actions());
    expect(menu[0]).toMatchObject({ label: "No Guesses Found", enabled: false });
    expect(menu.some((item) => item.label === "Add to Dictionary")).toBe(true);
  });

  it("follows the spelling items with the editing commands, enabled per what the field allows", () => {
    const menu = contextMenuTemplate({ ...field, misspelledWord: "teh", dictionarySuggestions: ["the"] }, actions());
    expect(menu.map((item) => item.type ?? item.role ?? item.label)).toEqual([
      "the",
      "separator",
      "Add to Dictionary",
      "separator",
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
    expect(menu.filter((item) => item.role).map((item) => [item.role, item.enabled])).toEqual([
      ["cut", false],
      ["copy", false],
      ["paste", true],
      ["selectAll", true],
    ]);
  });

  it("has only the editing commands when nothing is misspelled", () => {
    const menu = contextMenuTemplate(field, actions());
    expect(menu.map((item) => item.role)).toEqual(["cut", "copy", "paste", "selectAll"]);
  });

  it("offers Copy over selected text outside a field, and nothing otherwise", () => {
    const page = { ...field, isEditable: false };
    expect(contextMenuTemplate({ ...page, selectionText: "hello" }, actions())).toEqual([{ role: "copy" }]);
    expect(contextMenuTemplate(page, actions())).toEqual([]);
  });

  it("ignores a misspelled word that is not in an editable field", () => {
    const menu = contextMenuTemplate({ ...field, isEditable: false, misspelledWord: "teh", dictionarySuggestions: ["the"] }, actions());
    expect(menu).toEqual([]);
  });
});
