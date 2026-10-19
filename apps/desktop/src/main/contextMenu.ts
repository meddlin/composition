import { Menu } from "electron";
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from "electron";

/** Electron shows no context menu of its own, so right-clicking a misspelled word would do nothing. */
const MAX_SUGGESTIONS = 5;

type Params = Pick<ContextMenuParams, "isEditable" | "misspelledWord" | "dictionarySuggestions" | "selectionText"> & {
  editFlags: Pick<ContextMenuParams["editFlags"], "canCut" | "canCopy" | "canPaste" | "canSelectAll">;
};

type Actions = {
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
};

/**
 * What the right-click menu holds for what was clicked: spelling corrections and "Add to Dictionary"
 * on a misspelled word, then the usual editing commands in a text field (or Copy over a selection).
 * Empty when there is nothing to offer, in which case no menu should open.
 */
export function contextMenuTemplate(params: Params, actions: Actions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  if (params.isEditable && params.misspelledWord) {
    const word = params.misspelledWord;
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);
    if (suggestions.length > 0) {
      for (const suggestion of suggestions) {
        items.push({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) });
      }
    } else {
      items.push({ label: "No Guesses Found", enabled: false });
    }
    items.push({ type: "separator" }, { label: "Add to Dictionary", click: () => actions.addToDictionary(word) });
  }

  const editing: MenuItemConstructorOptions[] = params.isEditable
    ? [
        { role: "cut", enabled: params.editFlags.canCut },
        { role: "copy", enabled: params.editFlags.canCopy },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      ]
    : params.selectionText
      ? [{ role: "copy" }]
      : [];

  if (items.length > 0 && editing.length > 0) items.push({ type: "separator" });
  return [...items, ...editing];
}

/** Opens the menu above on right-click. Spellchecking itself is Chromium's, turned on in the window's webPreferences. */
export function installContextMenu(webContents: WebContents): void {
  webContents.on("context-menu", (_event, params) => {
    const template = contextMenuTemplate(params, {
      replaceMisspelling: (word) => webContents.replaceMisspelling(word),
      addToDictionary: (word) => void webContents.session.addWordToSpellCheckerDictionary(word),
    });
    if (template.length > 0) Menu.buildFromTemplate(template).popup();
  });
}
