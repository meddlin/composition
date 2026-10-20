import type { Processor } from "unified";

type Extension = { disable?: { null?: string[] } };

/**
 * Brings back indented code blocks (four spaces, or a tab, after a blank line) in notes read as MDX.
 * MDX switches that Markdown syntax off, along with HTML and autolinks, so a note that had a
 * component (or, now, a highlight) would show its indented code as an ordinary paragraph. In a
 * note that is Markdown first, that is wrong. HTML and autolinks stay off: JSX needs the `<`.
 *
 * Add it right after `remarkMdx`. It edits the list of switched-off syntax that plugin registers, so
 * `remarkIndentedCode.test.ts` fails if a new version of it changes how that is kept.
 */
export function remarkIndentedCode(this: Processor) {
  const extensions = (this.data() as { micromarkExtensions?: Extension[] }).micromarkExtensions ?? [];
  for (const extension of extensions) {
    const off = extension.disable?.null;
    if (off) extension.disable!.null = off.filter((construct) => construct !== "codeIndented");
  }
}
