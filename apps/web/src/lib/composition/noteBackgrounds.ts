/**
 * Backgrounds the user can choose for the app window in Settings.
 *
 * A background is only a pattern drawn behind the text; the colors still come from the
 * selected color scheme, so every one of them works with every scheme (including the sun
 * blend). The patterns themselves live in `app/globals.css`, keyed by `data-note-background`
 * on <html>:
 *   plain     -> nothing, the scheme's own background (the default)
 *   architect -> a quad-ruled architect's notebook: a faint square grid, with a slightly
 *                firmer line every fifth square, behind the whole window (the sidebars keep
 *                their solid panels) and lined up to the text in the editor and preview
 */

export const NOTE_BACKGROUND_CHOICES = [
  { name: "plain", label: "Plain" },
  { name: "architect", label: "Architect's notebook (faint quad grid)" },
] as const;

export type NoteBackgroundName = (typeof NOTE_BACKGROUND_CHOICES)[number]["name"];

export const DEFAULT_NOTE_BACKGROUND: NoteBackgroundName = "plain";

export function isNoteBackgroundName(value: unknown): value is NoteBackgroundName {
  return NOTE_BACKGROUND_CHOICES.some((choice) => choice.name === value);
}
