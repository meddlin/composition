import { DEFAULT_HIGHLIGHT_COLOR, type HighlightColor } from "./mdx/highlightColors";

// The colour the menu starts on. Shared by every open note, and kept until the app is reloaded.
let last: HighlightColor = DEFAULT_HIGHLIGHT_COLOR;

export const lastHighlightColor = () => last;
export const rememberHighlightColor = (color: HighlightColor) => {
  last = color;
};
export const resetLastHighlightColor = () => {
  last = DEFAULT_HIGHLIGHT_COLOR;
};
