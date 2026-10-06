/**
 * Every key the app binds, in one list: the handlers, the footer and the `?` overlay all
 * read it, so they cannot drift apart. docs/ui/cli-keybindings.md explains the rules and
 * the keys that must never appear here (the editor's, and the ones macOS keeps).
 */

export type Scope = "tree" | "pane" | "trash" | "settings";

export type ActionId =
  | "open"
  | "open-beside"
  | "open-trash"
  | "collapse"
  | "expand"
  | "new-note"
  | "new-group"
  | "rename-group"
  | "move"
  | "favorite"
  | "delete"
  | "search"
  | "help"
  | "quit"
  | "to-tree"
  | "next-pane"
  | "cycle-view"
  | "close-pane"
  | "restore"
  | "delete-forever"
  | "next-field"
  | "confirm"
  | "save"
  | "back";

export type KeyBinding = {
  action: ActionId;
  scope: Scope;
  /** Normalized key ids (see `keyId`). */
  keys: readonly string[];
  /** Short text for the footer. */
  hint: string;
  /** What the `?` overlay says. */
  description: string;
  /** Shown in the footer for its scope. */
  footer: boolean;
  /** Kept in the footer even when the terminal is too narrow for every hint. */
  essential?: boolean;
};

export const BINDINGS: readonly KeyBinding[] = [
  // Most useful first: when the footer must shorten, the later hints go first.
  { action: "open", scope: "tree", keys: ["enter"], hint: "Enter open", description: "Open the note in the focused pane", footer: true },
  { action: "collapse", scope: "tree", keys: ["left"], hint: "← fold", description: "Collapse the highlighted group", footer: false },
  { action: "expand", scope: "tree", keys: ["right"], hint: "→ unfold", description: "Expand the highlighted group", footer: false },
  { action: "new-note", scope: "tree", keys: ["ctrl+n"], hint: "ctrl+n note", description: "New note in the highlighted group", footer: true },
  { action: "search", scope: "tree", keys: ["/", "ctrl+space"], hint: "/ search", description: "Focus the search bar", footer: true },
  { action: "delete", scope: "tree", keys: ["ctrl+d"], hint: "ctrl+d delete", description: "Delete the highlighted note or group (a note goes to the Trash Can)", footer: true },
  { action: "open-trash", scope: "tree", keys: ["t"], hint: "t trash", description: "Open the Trash Can: restore or permanently delete what you deleted", footer: true },
  { action: "open-beside", scope: "tree", keys: ["o"], hint: "o open beside", description: "Open the note in a new pane to the right", footer: true },
  { action: "new-group", scope: "tree", keys: ["ctrl+g"], hint: "ctrl+g group", description: "New group inside the highlighted group", footer: true },
  { action: "move", scope: "tree", keys: ["m"], hint: "m move", description: "Move the highlighted note or group", footer: true },
  { action: "rename-group", scope: "tree", keys: ["r"], hint: "r rename", description: "Rename the highlighted group", footer: false },
  { action: "favorite", scope: "tree", keys: ["f"], hint: "f pin", description: "Pin or unpin the highlighted note or group", footer: false },
  { action: "help", scope: "tree", keys: ["?"], hint: "? help", description: "Show every key", footer: true, essential: true },
  { action: "next-pane", scope: "tree", keys: ["ctrl+o"], hint: "ctrl+o panes", description: "Go to the first pane", footer: false },
  { action: "quit", scope: "tree", keys: ["q"], hint: "q quit", description: "Quit", footer: true, essential: true },

  { action: "to-tree", scope: "pane", keys: ["escape"], hint: "Esc tree", description: "Back to the tree", footer: true, essential: true },
  { action: "next-pane", scope: "pane", keys: ["ctrl+o"], hint: "ctrl+o next pane", description: "Next pane (tree, pane 1, pane 2, … then the tree)", footer: true },
  { action: "cycle-view", scope: "pane", keys: ["ctrl+t"], hint: "ctrl+t view", description: "Cycle the pane's view: editor, split, preview", footer: true },
  { action: "close-pane", scope: "pane", keys: ["ctrl+x"], hint: "ctrl+x close", description: "Close the pane", footer: true },
  { action: "new-note", scope: "pane", keys: ["ctrl+n"], hint: "ctrl+n note", description: "New note", footer: false },

  { action: "restore", scope: "trash", keys: ["r"], hint: "r restore", description: "Restore the highlighted note or group", footer: true },
  { action: "delete-forever", scope: "trash", keys: ["ctrl+d"], hint: "ctrl+d delete forever", description: "Delete it for good", footer: true },
  { action: "back", scope: "trash", keys: ["escape"], hint: "Esc back", description: "Back to the notes", footer: true, essential: true },

  { action: "next-field", scope: "settings", keys: ["tab"], hint: "Tab next field", description: "Move to the next setting", footer: true },
  { action: "save", scope: "settings", keys: ["enter"], hint: "Enter save", description: "Save the data location or city, apply the highlighted color scheme, create a backup, or ask to restore one", footer: true },
  { action: "confirm", scope: "settings", keys: ["y"], hint: "y confirm", description: "Confirm restoring a backup, when asked (any other key cancels)", footer: false },
  { action: "back", scope: "settings", keys: ["escape"], hint: "Esc back", description: "Back to the notes", footer: true, essential: true },
];

/** The part of an OpenTUI key event the keymap looks at. */
export type KeyLike = { name: string; ctrl?: boolean; meta?: boolean; shift?: boolean };

/** `ctrl+n`, `alt+left`, `escape`, `/` … : modifiers in a fixed order, then the key's name. */
export function keyId(key: KeyLike): string {
  const name = key.name === "return" ? "enter" : key.name;
  return [key.ctrl && "ctrl", key.meta && "alt", key.shift && "shift", name].filter(Boolean).join("+");
}

export function actionFor(scope: Scope, key: KeyLike): ActionId | undefined {
  const id = keyId(key);
  return BINDINGS.find((binding) => binding.scope === scope && binding.keys.includes(id))?.action;
}

export function bindingsFor(scope: Scope): KeyBinding[] {
  return BINDINGS.filter((binding) => binding.scope === scope);
}

const FOOTER_SEPARATOR = "  ·  ";

/**
 * The footer line for a scope: its hints in list order. When the terminal is too narrow for
 * all of them, the later ones are dropped first, but the essential ones (help, quit, the
 * way back) always stay.
 */
export function footerFor(scope: Scope, width = Number.POSITIVE_INFINITY): string {
  let hints = bindingsFor(scope).filter((binding) => binding.footer);
  const text = () => hints.map((binding) => binding.hint).join(FOOTER_SEPARATOR);
  while (text().length > width) {
    const droppable = hints.map((binding) => binding.essential).lastIndexOf(undefined);
    if (droppable === -1) break;
    hints = hints.filter((_, index) => index !== droppable);
  }
  return text();
}
