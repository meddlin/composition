import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { BlockWidget } from "./liveBlockWidget";
import { liveBlocksField, redrawBlocks, type LiveBlocks } from "./liveBlocks";
import { elementEnd, liveMdxBlocks, mdxProblem, tagsIn } from "./liveMdx";

const INFO = "<Info>\n\nStaging resets **nightly**.\n\n- back up first\n- then deploy\n\n</Info>";
const CHART = '<Chart type="line" x="month" y="sales" title="2026">\n\n```csv\nmonth,sales\nJan,10\nFeb,12\n```\n\n</Chart>';
const YOUTUBE = '<YouTube url="https://youtu.be/dQw4w9WgXcQ" />';

function stateOf(doc: string, caret = doc.length): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage }), liveBlocksField, liveMdxBlocks],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state.update({}).state;
}

function apply(state: EditorState, spec: TransactionSpec): EditorState {
  const next = state.update(spec).state;
  ensureSyntaxTree(next, next.doc.length, 5000);
  return next.update({}).state;
}

const field = (state: EditorState): LiveBlocks => state.field(liveBlocksField);
const sources = (state: EditorState) => field(state).blocks.map(({ from, to }) => state.sliceDoc(from, to));
const kinds = (state: EditorState) => field(state).blocks.map((block) => block.kind.name ?? block.kind.node);

type Drawn = { source: string; beside: boolean; at: number };
function drawn(state: EditorState): Drawn[] {
  const out: Drawn[] = [];
  field(state).decorations.between(0, state.doc.length, (from, _to, value) => {
    const widget = value.spec.widget as BlockWidget;
    out.push({ source: widget.source, beside: widget.beside, at: from });
  });
  return out;
}

describe("finding MDX component blocks", () => {
  it("finds each block component whole, the Markdown and blank lines inside it included", () => {
    const doc = `Intro\n\n${INFO}\n\nMiddle\n\n${CHART}\n\n${YOUTUBE}\n\n| a |\n|---|\n| 1 |\n\nEnd`;
    const state = stateOf(doc);
    expect(sources(state)).toEqual([INFO, CHART, YOUTUBE, "| a |\n|---|\n| 1 |"]);
    expect(kinds(state)).toEqual(["mdx-Info", "mdx-Chart", "mdx-YouTube", "Table"]);
    // Away from the caret each is drawn in place of its source.
    expect(drawn(state).map(({ beside }) => beside)).toEqual([false, false, false, false]);
  });

  it("finds each of the seven components, and gives the sheet and the video an Edit source button", () => {
    const sheet = '<Sheet title="Q3">\n\n```csv\nRegion,Units\nWest,120\n```\n\n</Sheet>';
    const parts = [
      INFO,
      "<Warning>\n\nCareful.\n\n</Warning>",
      '<Drawio src="app_data/a-diagram-3f9c2a71b0de.png" alt="Flow" />',
      CHART,
      '<Repo url="https://github.com/meddlin/composition" />',
      sheet,
      YOUTUBE,
    ];
    const state = stateOf(parts.join("\n\n") + "\n\nEnd");
    expect(sources(state)).toEqual(parts);
    expect(field(state).blocks.map((block) => [block.kind.name, !!block.kind.ownsClicks])).toEqual([
      ["mdx-Info", false],
      ["mdx-Warning", false],
      ["mdx-Drawio", false],
      ["mdx-Chart", false],
      ["mdx-Repo", false],
      ["mdx-Sheet", true],
      ["mdx-YouTube", true],
    ]);
  });

  it("leaves inline tags, Step 7's components and tags in code alone", () => {
    const doc = [
      '<Image src="app_data/a.png" alt="A" />',
      '<Ink src="app_data/b.png" alt="B" />',
      'Some <Mark color="yellow">marked</Mark> words.',
      "<Toc />",
      "<Footnotes />",
      "```mdx\n<Info>\n\nIn a fence.\n\n</Info>\n```",
      "    <Warning>Indented code</Warning>",
      "End",
    ].join("\n\n");
    expect(field(stateOf(doc)).blocks).toEqual([]);
  });

  it("matches nested tags of the same name, and skips a closing tag in a code fence", () => {
    const inner = "<Info>\n\nInner.\n\n</Info>";
    const nested = `<Info>\n\nOuter.\n\n${inner}\n\n\`\`\`\n</Info>\n\`\`\`\n\n</Info>`;
    const state = stateOf(`${nested}\n\nAfter`);
    expect(sources(state)).toEqual([nested]);
  });

  it("reads an opening tag that runs over several lines", () => {
    const chart = '<Chart\n  type="bar"\n  title="Split over lines"\n>\n\n```csv\na,b\nx,1\n```\n\n</Chart>';
    expect(sources(stateOf(`${chart}\n\nAfter`))).toEqual([chart]);
  });

  it("starts nothing in the frontmatter", () => {
    const doc = `---\ntitle: <Info>\n---\n\n${YOUTUBE}`;
    expect(sources(stateOf(doc, 0))).toEqual([YOUTUBE]);
  });
});

describe("a component being typed", () => {
  it("is its opening line alone until it is closed, shown as source with a note under it", () => {
    const doc = "Before\n\n<Info>\n\nText being typed.\n\nAfter";
    const state = stateOf(doc, 0);
    expect(sources(state)).toEqual(["<Info>"]);
    // Not valid MDX yet: the source stays and the note is drawn under it, not in place of it.
    expect(drawn(state)).toEqual([{ source: "<Info>", beside: true, at: doc.indexOf("<Info>") + "<Info>".length }]);
    expect(mdxProblem("<Info>")).toMatch(/end of file|closing tag/i);
  });

  it("grows to the whole component when its closing tag is typed below, and shrinks when it is deleted", () => {
    const doc = "Before\n\n<Info>\n\nText being typed.\n\n";
    let state = stateOf(doc, 0);
    expect(sources(state)).toEqual(["<Info>"]);
    state = apply(state, { changes: { from: doc.length, insert: "</Info>" }, selection: { anchor: 0 } });
    expect(sources(state)).toEqual(["<Info>\n\nText being typed.\n\n</Info>"]);
    expect(drawn(state)[0].beside).toBe(false);

    state = apply(state, { changes: { from: doc.length, to: doc.length + "</Info>".length }, selection: { anchor: 0 } });
    expect(sources(state)).toEqual(["<Info>"]);
  });

  it("takes in a block below that its new opening tag now holds", () => {
    const doc = `Before\n\n${YOUTUBE}\n\n</Info>`;
    let state = stateOf(doc, 0);
    expect(sources(state)).toEqual([YOUTUBE]);
    state = apply(state, { changes: { from: "Before\n\n".length, insert: "<Info>\n\n" }, selection: { anchor: 0 } });
    expect(sources(state)).toEqual([`<Info>\n\n${YOUTUBE}\n\n</Info>`]);
  });

  it("shows the note under the source on the pause while it is not valid, and the drawing once it is", () => {
    const doc = `Before\n\n${YOUTUBE}\n\nAfter`;
    const tagEnd = doc.indexOf(" />");
    let state = stateOf(doc, 0);
    // The caret goes in, and a prop is typed half way: the last drawing stays until the pause.
    state = apply(state, { selection: { anchor: tagEnd } });
    state = apply(state, { changes: { from: tagEnd, insert: ' start="1' }, selection: { anchor: tagEnd + 9 } });
    expect(drawn(state)).toEqual([{ source: YOUTUBE, beside: true, at: expect.any(Number) }]);
    expect(mdxProblem(YOUTUBE)).toBeNull();

    state = apply(state, { effects: redrawBlocks.of(null) });
    const typed = state.sliceDoc(field(state).blocks[0].from, field(state).blocks[0].to);
    expect(drawn(state).map(({ source }) => source)).toEqual([typed]);
    expect(mdxProblem(typed)).not.toBeNull();

    // Finished, and the caret leaves: drawn in place of its source.
    state = apply(state, { changes: { from: tagEnd + 9, insert: '"' }, selection: { anchor: doc.length + 10 } });
    expect(drawn(state)).toEqual([{ source: YOUTUBE.replace(" />", ' start="1" />'), beside: false, at: expect.any(Number) }]);
  });

  it("is not drawn while it holds something MDX rejects, an expression or an unknown tag", () => {
    for (const bad of ["<Info>\n\nTotal: {1 + 1}\n\n</Info>", "<Info>\n\n<Spoiler>x</Spoiler>\n\n</Info>"]) {
      const state = stateOf(`${bad}\n\nAfter`);
      expect(sources(state)).toEqual([bad]);
      expect(drawn(state)[0].beside).toBe(true);
      expect(mdxProblem(bad)).toBeTruthy();
    }
  });
});

describe("reading tags", () => {
  it("finds where a tag ends, past quoted > and {braces}, and whether it closes itself", () => {
    const { tags } = tagsIn('<Chart title="a > b" x={y}>\n</Chart> <Chart />', ["Chart"]);
    expect(tags.map(({ close, selfClosing }) => [close, selfClosing])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
  });

  it("says a tag cut off by the end of the text needs more, and leaves out one broken by a blank line", () => {
    expect(tagsIn('<Info>\n<Chart title="half', ["Info", "Chart"]).more).toBe(true);
    expect(tagsIn("<Chart\n\ntype=\"bar\">", ["Chart"]).tags).toEqual([]);
  });

  it("finds an element's end however far below it is", () => {
    const filler = "Words in a paragraph.\n\n".repeat(2000);
    const doc = `<Info>\n\n${filler}</Info>\n`;
    const state = stateOf(doc, 0);
    expect(elementEnd(state, "Info", 0)).toBe(doc.length - 1);
    expect(sources(state)).toEqual([doc.slice(0, -1)]);
  });
});
