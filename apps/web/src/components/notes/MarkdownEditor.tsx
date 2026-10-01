import { useMemo, useRef, type CSSProperties } from "react";
import { parse } from "@/lib/composition/frontmatter";
import { dragRatio, MAX_EDITOR_RATIO, MIN_EDITOR_RATIO } from "@/lib/composition/layout";
import { FrontmatterCard } from "./FrontmatterCard";
import { NoteMarkdown } from "./NoteMarkdown";
import { ResizeHandle } from "./ResizeHandle";
import { useCodeHighlighting } from "./useCodeHighlighting";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** The editor's share (0-1) of the editor+preview area. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: () => void;
};

const paneHeader =
  "border-b border-foreground/10 px-4 py-2 text-xs font-medium uppercase tracking-wide text-foreground/50";

export function MarkdownEditor({ value, onChange, ratio, onRatioChange, onRatioCommit }: Props) {
  // The raw text (frontmatter included) stays in the editor; the preview shows
  // the frontmatter as a metadata card rather than as Markdown content.
  const [fm, body] = useMemo(() => parse(value), [value]);
  const rehypePlugins = useCodeHighlighting(body);

  const grid = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ ratio, width: 0 });

  return (
    // Column sizes go through CSS variables so the panes still stack below `md`.
    <div
      ref={grid}
      style={{ "--editor-col": `${ratio}fr`, "--preview-col": `${1 - ratio}fr` } as CSSProperties}
      className="grid min-w-0 flex-1 grid-cols-1 grid-rows-2 md:grid-cols-[minmax(0,var(--editor-col))_auto_minmax(0,var(--preview-col))] md:grid-rows-1"
    >
      <section className="flex min-h-0 flex-col">
        <h2 className={paneHeader}>Markdown</h2>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          aria-label="Markdown editor"
          placeholder="Start writing in Markdown…"
          className="flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-6 outline-none"
        />
      </section>
      <ResizeHandle
        label="Resize editor and preview"
        valueNow={Math.round(ratio * 100)}
        valueMin={MIN_EDITOR_RATIO * 100}
        valueMax={MAX_EDITOR_RATIO * 100}
        className="hidden md:block"
        onResizeStart={() => {
          dragStart.current = { ratio, width: grid.current?.getBoundingClientRect().width ?? 0 };
        }}
        onResize={(dx) => onRatioChange(dragRatio(dragStart.current.ratio, dx, dragStart.current.width))}
        onResizeEnd={onRatioCommit}
      />
      <section className="flex min-h-0 flex-col border-t border-foreground/10 md:border-t-0">
        <h2 className={paneHeader}>Preview</h2>
        <div className="prose max-w-none flex-1 overflow-y-auto p-4">
          {fm && <FrontmatterCard fm={fm} />}
          <NoteMarkdown body={body} rehypePlugins={rehypePlugins} />
        </div>
      </section>
    </div>
  );
}
