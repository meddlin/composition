import { PALETTE_SHORTCUT, PANEL_COMMANDS } from "../panels/panelCommands";

/**
 * Every keyboard shortcut the app answers to, for the shortcuts helper to list. This is
 * documentation, not wiring: each handler lives beside the thing it controls (SearchBar,
 * NotePane, useHighlightMenu, …) and must be kept in step with the entry here.
 *
 * Keys are tokens: "Mod" is Cmd on macOS and Ctrl elsewhere; the rest are shown as written.
 */
export type Combo = readonly string[];

export type Shortcut = {
  /** Alternatives that do the same thing, e.g. a modified key or a bare one. */
  combos: readonly Combo[];
  description: string;
};

export type ShortcutGroup = {
  title: string;
  shortcuts: readonly Shortcut[];
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Anywhere",
    shortcuts: [
      { combos: [["Mod", "K"]], description: "Search notes" },
      { combos: [["Mod", "/"], ["?"]], description: "Show or hide this list of shortcuts" },
      { combos: [["Mod", "Click"]], description: "Open a linked note beside the current one" },
      { combos: [["Mouse Back"], ["Cmd", "["], ["Alt", "←"]], description: "Go back to the note or page you were just looking at (Cmd is for Mac, Alt for other systems)" },
      { combos: [["Mouse Forward"], ["Cmd", "]"], ["Alt", "→"]], description: "Go forward again after going back" },
    ],
  },
  {
    title: "Editing a note",
    shortcuts: [
      { combos: [["Mod", "Shift", "H"]], description: "Highlight the selection (or recolor or remove a highlight at the caret)" },
      { combos: [["Mod", "Shift", "K"]], description: "Link to another note" },
      { combos: [["Mod", "Shift", "M"]], description: "Insert an image that is already stored (type to filter by name)" },
      { combos: [["Mod", "Shift", "X"]], description: "Turn the Markdown image at the caret (or in the selection) into an <Image /> tag, which can be resized" },
      { combos: [["Mod", "B"]], description: "Make the selected text bold (again to take it off)" },
      { combos: [["Mod", "I"]], description: "Make the selected text italic (again to take it off)" },
      { combos: [["Mod", "F"]], description: "Find in the note" },
      { combos: [["Mod", "Shift", "L"]], description: "Open the AI helper beside the note (on the web, again to close it)" },
      { combos: [["Tab"]], description: "Insert a tab (nested list items, code); with several lines selected, indent each of them" },
      { combos: [["Shift", "Tab"]], description: "Leave the editor; with several lines selected, outdent each of them" },
      { combos: [["Ctrl", "]"]], description: "Indent the line at the caret, or every line in the selection (Ctrl on a Mac too, since Cmd+] is Forward)" },
      { combos: [["Ctrl", "["]], description: "Outdent the line at the caret, or every line in the selection" },
    ],
  },
  {
    title: "Menus while editing",
    shortcuts: [
      { combos: [["↑"], ["↓"]], description: "Move through the choices (component, note link, image, highlight color)" },
      { combos: [["Enter"], ["Tab"]], description: "Pick the highlighted choice" },
      { combos: [["1–5"]], description: "Highlight menu: pick a color by its number" },
      { combos: [["0"]], description: "Highlight menu: remove the highlight" },
      { combos: [["Esc"]], description: "Close the menu" },
    ],
  },
  {
    title: "Find in note",
    shortcuts: [
      { combos: [["Enter"]], description: "Next match" },
      { combos: [["Shift", "Enter"]], description: "Previous match" },
      { combos: [["Esc"]], description: "Close find" },
    ],
  },
  {
    title: "Search results",
    shortcuts: [
      { combos: [["↑"], ["↓"]], description: "Move through the results" },
      { combos: [["Enter"]], description: "Open the highlighted note" },
      { combos: [["Esc"]], description: "Close the results" },
    ],
  },
  {
    title: "Views and layout",
    shortcuts: [
      { combos: [["←"], ["→"]], description: "On the Editor / Preview tabs: switch view" },
      { combos: [["Home"], ["End"]], description: "On the tabs: jump to the first or last view" },
      { combos: [["←"], ["→"]], description: "On a column divider: resize the column" },
    ],
  },
  {
    title: "Naming groups",
    shortcuts: [
      { combos: [["Enter"]], description: "Save the name" },
      { combos: [["Esc"]], description: "Cancel" },
    ],
  },
];

/**
 * The desktop app's panel commands, from the same table the keys are handled from, so the list cannot drift from them.
 * The commands with no key of their own are reached through the palette, which says so.
 */
const PANEL_GROUP: ShortcutGroup = {
  title: "Panels",
  shortcuts: [
    { combos: [PALETTE_SHORTCUT.keys], description: "Open the command palette, to run any panel command by name" },
    ...PANEL_COMMANDS.flatMap((command) =>
      command.shortcut ? [{ combos: [command.shortcut.keys], description: command.label }] : [],
    ),
  ],
};

/** The keys of the PDF reader (PdfReader.tsx, useMarkEditing.ts): the web app has no reader. */
const PDF_GROUP: ShortcutGroup = {
  title: "Reading a PDF",
  shortcuts: [
    { combos: [["Mod", "Shift", "H"]], description: "Highlight the selected text" },
    { combos: [["Mod", "Shift", "U"]], description: "Underline the selected text" },
    { combos: [["Mod", "Shift", "S"]], description: "Strike through the selected text" },
    { combos: [["Mod", "Z"]], description: "Undo the last change to the PDF's marks (until the app is closed)" },
    { combos: [["Mod", "Shift", "Z"], ["Ctrl", "Y"]], description: "Redo it" },
    { combos: [["Delete"], ["Backspace"]], description: "Delete the selected mark" },
    { combos: [["Esc"]], description: "Let go of the selected mark, or give up placing a text note" },
    { combos: [["Mod", "F"]], description: "Find in the PDF" },
  ],
};

/** The groups to list: the web app has no panels and no PDF reader, so only the desktop app lists theirs. */
export function shortcutGroups(desktop: boolean): readonly ShortcutGroup[] {
  if (!desktop) return SHORTCUT_GROUPS;
  const at = SHORTCUT_GROUPS.findIndex((group) => group.title === "Views and layout") + 1;
  return [...SHORTCUT_GROUPS.slice(0, at), PANEL_GROUP, PDF_GROUP, ...SHORTCUT_GROUPS.slice(at)];
}
