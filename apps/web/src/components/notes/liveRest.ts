import type { Extension } from "@codemirror/state";
import { liveBlockKinds, TABLE } from "./liveBlocks";
import { FOOTNOTES, liveFootnotes } from "./liveFootnotes";
import { liveFrontmatter } from "./liveFrontmatter";
import { liveSettledNote } from "./liveSettled";
import { liveSetext } from "./liveSetext";
import { TOC } from "./liveToc";

/**
 * Step 7 of docs/live-default-plan.md, "the rest": setext headings, footnotes, `<Toc />`, `<Footnotes />` and the
 * frontmatter card. Goes in an editor that has `liveMarkdown` and `liveBlocks`.
 */
export const liveRest: Extension = [
  // Giving the block layer kinds replaces its default (tables), so tables are named again.
  liveBlockKinds.of(TABLE),
  liveBlockKinds.of(TOC),
  liveBlockKinds.of(FOOTNOTES),
  liveFrontmatter,
  liveSetext,
  liveFootnotes,
  liveSettledNote,
];
