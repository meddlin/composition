import type { SyntaxStyle } from "@opentui/core";
import { useMemo } from "react";
import type { Api } from "../api";
import { parsePreview, type Block, type TocEntry } from "../mdx";
import { mix, type Palette } from "../theme";
import { PreviewImage } from "./PreviewImage";

type Look = { palette: Palette; syntax: SyntaxStyle; api: Pick<Api, "readImage"> };

/** How much of a panel's color tints its background: enough to read as a callout, not to fight the text. */
export const PANEL_TINT = 0.14;

/**
 * A note's rendered preview: its Markdown, drawn by OpenTUI, with the MDX components the web
 * and desktop apps also render (see mdx.ts) drawn as panels and a table of contents, and its
 * images drawn as images. A note that
 * isn't valid MDX, which it is for as long as a tag is half-typed, shows why above a plain
 * Markdown render of the note, and recovers as soon as it is valid again.
 */
export function Preview({ body, palette, syntax, api }: Look & { body: string }) {
  const { blocks, error } = useMemo(() => parsePreview(body), [body]);
  return (
    <box flexDirection="column">
      {error && (
        <box border borderStyle="rounded" borderColor={palette.warning} paddingLeft={1} paddingRight={1} marginBottom={1}>
          <text fg={palette.warning}>{`Couldn’t render this note’s components: ${sentence(error)} Showing it as plain Markdown.`}</text>
        </box>
      )}
      <Blocks blocks={blocks} palette={palette} syntax={syntax} api={api} />
    </box>
  );
}

/** MDX's messages end in a position, such as `(4:1-4:7)`, rather than a full stop. */
const sentence = (message: string) => (/[.!?]$/.test(message) ? message : `${message}.`);

/** `background` is set inside a panel, whose tint the Markdown must be drawn over. */
function Blocks({ blocks, palette, syntax, api, background }: Look & { blocks: Block[]; background?: string }) {
  return (
    <>
      {blocks.map((block, index) => {
        // A blank line between blocks, as between paragraphs.
        const marginTop = index === 0 ? 0 : 1;
        switch (block.kind) {
          case "markdown":
            return <markdown key={index} content={block.source} syntaxStyle={syntax} bg={background} marginTop={marginTop} />;
          case "panel":
            return <Panel key={index} block={block} marginTop={marginTop} palette={palette} syntax={syntax} api={api} />;
          case "toc":
            return <Toc key={index} entries={block.entries} marginTop={marginTop} palette={palette} />;
          case "image":
            return <PreviewImage key={index} block={block} api={api} palette={palette} marginTop={marginTop} />;
        }
      })}
    </>
  );
}

const PANELS = {
  info: { label: "Info", color: (p: Palette) => p.primary },
  warning: { label: "Warning", color: (p: Palette) => p.warning },
};

/** A Confluence-style callout: a box in the tone's color, tinted, labelled, with the content inside. */
function Panel({ block, marginTop, palette, syntax, api }: Look & { block: Extract<Block, { kind: "panel" }>; marginTop: number }) {
  const { label, color } = PANELS[block.tone];
  const tone = color(palette);
  const tint = mix(palette.surface, tone, PANEL_TINT);
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={tone}
      backgroundColor={tint}
      title={` ${label} `}
      titleColor={tone}
      paddingLeft={1}
      paddingRight={1}
      marginTop={marginTop}
      flexDirection="column"
    >
      <Blocks blocks={block.blocks} palette={palette} syntax={syntax} api={api} background={tint} />
    </box>
  );
}

/** The note's headings, nested; they follow the note as it is edited because the preview is rebuilt from it. */
function Toc({ entries, marginTop, palette }: { entries: TocEntry[]; marginTop: number; palette: Palette }) {
  return (
    <box
      border
      borderStyle="single"
      borderColor={palette.border}
      title=" Contents "
      titleColor={palette.muted}
      paddingLeft={1}
      paddingRight={1}
      marginTop={marginTop}
      flexDirection="column"
    >
      {entries.length === 0 ? (
        <text fg={palette.muted}>No headings yet.</text>
      ) : (
        entries.map((entry, index) => (
          <text key={index} fg={palette.primary}>{`${"  ".repeat(entry.level)}• ${entry.text}`}</text>
        ))
      )}
    </box>
  );
}
