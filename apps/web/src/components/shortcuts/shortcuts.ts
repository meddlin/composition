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
    ],
  },
  {
    title: "Editing a note",
    shortcuts: [
      { combos: [["Mod", "Shift", "H"]], description: "Highlight the selection (or recolor or remove a highlight at the caret)" },
      { combos: [["Mod", "Shift", "K"]], description: "Link to another note" },
      { combos: [["Mod", "Shift", "M"]], description: "Insert an image that is already stored (type to filter by name)" },
      { combos: [["Mod", "Shift", "X"]], description: "Turn the Markdown image at the caret (or in the selection) into an <Image /> tag, which can be resized" },
      { combos: [["Mod", "F"]], description: "Find in the note" },
      { combos: [["Mod", "Shift", "L"]], description: "Open the AI helper beside the note (on the web, again to close it)" },
      { combos: [["Tab"]], description: "Insert a tab (nested list items, code)" },
      { combos: [["Shift", "Tab"]], description: "Leave the editor" },
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

/** The groups to list: the web app has no panels, so only the desktop app lists their commands. */
export function shortcutGroups(desktop: boolean): readonly ShortcutGroup[] {
  if (!desktop) return SHORTCUT_GROUPS;
  const at = SHORTCUT_GROUPS.findIndex((group) => group.title === "Views and layout") + 1;
  return [...SHORTCUT_GROUPS.slice(0, at), PANEL_GROUP, ...SHORTCUT_GROUPS.slice(at)];
}
