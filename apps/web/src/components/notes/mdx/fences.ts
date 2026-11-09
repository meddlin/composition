/**
 * Where a note's fenced code blocks are, read from its text. Kept apart from `completions.ts`, which names the component
 * registry (and so every component) in a type, so code that only needs this (the sheet's, which the desktop app's tools
 * read too) does not pull the components in with it.
 */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/gm;

/** Whether the line starting at `lineStart` sits inside a fenced code block. */
export function insideFence(text: string, lineStart: number): boolean {
  return (text.slice(0, lineStart).match(FENCE)?.length ?? 0) % 2 === 1;
}
