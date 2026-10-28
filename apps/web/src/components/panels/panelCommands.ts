import type { Combo } from "../shortcuts/shortcuts";

export type PanelCommandId =
  | "split-right"
  | "split-down"
  | "close-panel"
  | "next-panel"
  | "previous-panel"
  | "move-to-new-window"
  | "move-to-main-window";

/**
 * A key for a command. `keys` is what is shown, in the shortcuts list's tokens ("Mod" is Cmd on macOS and Ctrl elsewhere);
 * `code` is the physical key it is matched by, so it works on layouts that type another character there. Every command
 * key is held with Cmd or Ctrl and Shift, and never Alt, which AltGr types characters with on some layouts.
 */
export type CommandShortcut = { keys: Combo; code: string };

export type PanelCommand = {
  id: PanelCommandId;
  label: string;
  /** Other words that find the command in the palette. */
  keywords: readonly string[];
  shortcut?: CommandShortcut;
};

/** The panel commands, in the order the palette lists them. */
export const PANEL_COMMANDS: readonly PanelCommand[] = [
  {
    id: "split-right",
    label: "Split Right",
    keywords: ["add", "new panel", "beside", "column", "side by side"],
    shortcut: { keys: ["Mod", "Shift", "\\"], code: "Backslash" },
  },
  { id: "split-down", label: "Split Down", keywords: ["add", "new panel", "below", "row", "stack"] },
  { id: "close-panel", label: "Close Panel", keywords: ["remove"], shortcut: { keys: ["Mod", "Shift", "W"], code: "KeyW" } },
  {
    id: "next-panel",
    label: "Next Panel",
    keywords: ["focus", "switch", "forward", "right"],
    shortcut: { keys: ["Mod", "Shift", "]"], code: "BracketRight" },
  },
  {
    id: "previous-panel",
    label: "Previous Panel",
    keywords: ["focus", "switch", "back", "left"],
    shortcut: { keys: ["Mod", "Shift", "["], code: "BracketLeft" },
  },
  { id: "move-to-new-window", label: "Move to New Window", keywords: ["pop out", "detach", "separate window"] },
  { id: "move-to-main-window", label: "Move to Main Window", keywords: ["pop in", "return", "bring back", "attach"] },
];

/** Opens the palette. */
export const PALETTE_SHORTCUT: CommandShortcut = { keys: ["Mod", "Shift", "P"], code: "KeyP" };

type KeyEvent = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat" | "isComposing">;

function pressed(event: KeyEvent, shortcut: CommandShortcut): boolean {
  if (event.repeat || event.isComposing || event.altKey) return false;
  return (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === shortcut.code;
}

/** The command a key press is for, or null. A key held down does not repeat it. */
export function panelCommandForKey(event: KeyEvent): PanelCommandId | null {
  return PANEL_COMMANDS.find((command) => command.shortcut && pressed(event, command.shortcut))?.id ?? null;
}

export function isPaletteShortcut(event: KeyEvent): boolean {
  return pressed(event, PALETTE_SHORTCUT);
}

const startsWord = (text: string, token: string) => text.split(/\s+/).some((word) => word.startsWith(token));

function isSubsequence(token: string, text: string): boolean {
  let at = 0;
  for (const letter of text) if (letter === token[at]) at += 1;
  return at === token.length;
}

/** How well one word of the query matches a command: 0 for not at all, higher for a better match. */
function scoreToken(command: PanelCommand, token: string): number {
  const label = command.label.toLowerCase();
  if (label.startsWith(token)) return 5;
  if (startsWord(label, token)) return 4;
  if (command.keywords.some((keyword) => startsWord(keyword, token))) return 3;
  if (label.includes(token) || command.keywords.some((keyword) => keyword.includes(token))) return 2;
  // Letters in order, as in other palettes ("sr" for Split Right); too loose for a single letter.
  if (token.length >= 2 && isSubsequence(token, label)) return 1;
  return 0;
}

/**
 * The commands that match a search, best first. Every word of the query has to match; an empty query lists them all.
 * Ties keep the order of `PANEL_COMMANDS`.
 */
export function searchPanelCommands(query: string): PanelCommand[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...PANEL_COMMANDS];

  const scored = PANEL_COMMANDS.flatMap((command, order) => {
    const scores = tokens.map((token) => scoreToken(command, token));
    return scores.every((score) => score > 0) ? [{ command, order, score: scores.reduce((sum, score) => sum + score, 0) }] : [];
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map(({ command }) => command);
}
