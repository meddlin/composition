import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { BlockKind } from "./liveBlockWidget";
import { useFollowInLive } from "./liveFootnotes";
import { frontmatterEndIn } from "./liveFrontmatter";
import { useSettledNote } from "./liveSettled";
import { Toc } from "./mdx/Toc";
import { slugify, type TocHeading } from "./mdx/remarkHeadings";
import { extractHeadings } from "./noteHeadings";

/**
 * `<Toc />` in the Live tab (Step 7 of docs/live-default-plan.md): drawn by Preview's own `Toc`, handed the note's
 * headings as Preview's `remarkHeadings` hands them, but read from the text (`extractHeadings`, which the heading rail
 * uses too) once typing pauses. Each entry's id is the slug `#heading` links use (`fragmentOffset`), so a click on
 * one scrolls Live to its heading the way following such a link does.
 */

/** The note's headings, as `Toc` takes them (JSON), with the ids `fragmentOffset` finds them by. */
export function tocHeadings(state: EditorState): string {
  const taken = new Set<string>();
  const headings: TocHeading[] = extractHeadings(state.doc.toString(), frontmatterEndIn(state)).map(({ level, label }) => {
    const base = slugify(label);
    let id = base;
    for (let n = 1; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return { depth: level, text: label, id };
  });
  return JSON.stringify(headings);
}

/** The `maxDepth` a `<Toc maxDepth="3" />` asks for (written `"3"`, `'3'` or `{3}`), if any. */
export function tocMaxDepth(source: string): string | undefined {
  const match = /\bmaxDepth\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']?(\d+)["']?\s*\})/.exec(source);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function TocDrawing({ source, view }: { source: string; view: EditorView }) {
  const headings = useSettledNote(view, tocHeadings);
  const follow = useFollowInLive(view);
  return (
    <div className="cm-live-toc" onClickCapture={follow}>
      <Toc headings={headings} maxDepth={tocMaxDepth(source)} />
    </div>
  );
}

/** `<Toc />` on a line of its own, as a block (see `BlockKind`). Its entries are links, so it has "Edit source". */
export const TOC: BlockKind = {
  // Lezer reads a self-closing tag on its own line as a paragraph (its HTML block rule does not take `/>`).
  node: "Paragraph",
  ownsClicks: true,
  accepts: (source) => /^\s*<Toc(?:\s[^<>]*)?\/>\s*$/.test(source),
  Drawing: TocDrawing,
};
