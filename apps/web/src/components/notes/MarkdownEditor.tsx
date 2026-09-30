import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parse } from "@/lib/composition/frontmatter";
import { FrontmatterCard } from "./FrontmatterCard";
import { useCodeHighlighting } from "./useCodeHighlighting";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

const paneHeader =
  "border-b border-foreground/10 px-4 py-2 text-xs font-medium uppercase tracking-wide text-foreground/50";

export function MarkdownEditor({ value, onChange }: Props) {
  // The raw text (frontmatter included) stays in the editor; the preview shows
  // the frontmatter as a metadata card rather than as Markdown content.
  const [fm, body] = useMemo(() => parse(value), [value]);
  const rehypePlugins = useCodeHighlighting(body);

  return (
    <div className="grid min-w-0 flex-1 grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
      <section className="flex min-h-0 flex-col md:border-r md:border-foreground/10">
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
      <section className="flex min-h-0 flex-col border-t border-foreground/10 md:border-t-0">
        <h2 className={paneHeader}>Preview</h2>
        <div className="prose max-w-none flex-1 overflow-y-auto p-4">
          {fm && <FrontmatterCard fm={fm} />}
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
            {body}
          </Markdown>
        </div>
      </section>
    </div>
  );
}
