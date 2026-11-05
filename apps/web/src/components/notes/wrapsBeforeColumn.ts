import { caretCoordinates } from "./caretCoordinates";

/**
 * Whether the textarea has already wrapped the line holding `caret` before it gets `column` characters long.
 *
 * Reflow counts characters, but a narrow pane wraps by width: a pane that shows 50 characters to a row has moved the
 * rest of an 80-character line down by the time reflow would break it, and a break at the column then lands part-way
 * along a row. Where the pane has already done the wrapping, reflow has nothing to add. The layout is read off the
 * browser (a textarea can't say where its rows break), so a textarea that has no layout, such as a hidden one, never
 * counts as wrapped.
 */
export function wrapsBeforeColumn(el: HTMLTextAreaElement, caret: number, column: number): boolean {
  const lineStart = caret === 0 ? 0 : el.value.lastIndexOf("\n", caret - 1) + 1;
  return caretCoordinates(el, lineStart + column).top > caretCoordinates(el, lineStart).top;
}
