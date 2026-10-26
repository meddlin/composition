import { insideFence, type MdxCompletion } from "./completions";
import type { PropTarget } from "./props";

type Snippet = { name: string; description: string; template: string };

/** Pre-formatted Markdown offered after a `/`. `$0` marks where the caret lands. */
const snippets: Snippet[] = [
  {
    name: "table",
    description: "A 3-column table with a header and two rows",
    template: "| $0Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n",
  },
  {
    name: "codeblock",
    description: "A fenced code block",
    template: "```\n$0\n```\n",
  },
  {
    name: "tasks",
    description: "A task list",
    template: "- [ ] $0\n- [ ] \n- [ ] \n",
  },
  {
    name: "divider",
    description: "A horizontal rule",
    template: "---\n\n$0",
  },
];

/** A `/` at the start of a line or after whitespace, with letters typed after it. */
const SLASH = /(?:^|\s)\/([A-Za-z]*)$/;

/**
 * What to offer when the caret is just after a `/` that starts a word: the snippets whose name
 * starts with what was typed. Null anywhere else: inside a word like `and/or`, or in a fenced code block.
 */
export function findSnippetTarget(text: string, caret: number): PropTarget | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const match = SLASH.exec(text.slice(lineStart, caret));
  if (!match || insideFence(text, lineStart)) return null;

  const query = match[1];
  const items: MdxCompletion[] = snippets
    .filter(({ name }) => name.startsWith(query.toLowerCase()))
    .map(({ name, description, template }) => ({ name, label: `/${name}`, description, template }));
  return { start: caret - query.length - 1, end: caret, query, items, label: "Markdown snippets" };
}
