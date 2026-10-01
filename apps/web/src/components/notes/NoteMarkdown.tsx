import { Component, type ReactNode } from "react";
import Markdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import { mdxComponents, mdxComponentsByKey, usesMdxComponent } from "./mdx/components";
import { remarkRestrictMdx } from "./mdx/remarkRestrictMdx";
import { markdownComponents } from "./NoteImage";

type Props = {
  body: string;
  rehypePlugins: NonNullable<Options["rehypePlugins"]>;
};

// Markdown's own elements that get a custom rendering (images), kept alongside the MDX tags.
const noteComponents = { ...markdownComponents, ...mdxComponentsByKey };

const mdxRemarkPlugins: NonNullable<Options["remarkPlugins"]> = [
  remarkGfm,
  remarkMdx,
  [remarkRestrictMdx, { allowed: Object.keys(mdxComponents) }],
];

// remark-rehype turns node types it doesn't know into <div>s; these are left
// for react-markdown to render, using `mdxComponentsByKey`.
const mdxRehypeOptions: NonNullable<Options["remarkRehypeOptions"]> = {
  passThrough: ["mdxJsxFlowElement", "mdxJsxTextElement"],
};

/**
 * A note's rendered preview: Markdown (with images shown by `NoteImage`), plus
 * the MDX components in `mdxComponents` for notes that use any of them.
 */
export function NoteMarkdown({ body, rehypePlugins }: Props) {
  const plain = (
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={markdownComponents}>
      {body}
    </Markdown>
  );
  if (!usesMdxComponent(body)) return plain;

  return (
    <MdxBoundary body={body} fallback={plain}>
      <Markdown
        remarkPlugins={mdxRemarkPlugins}
        remarkRehypeOptions={mdxRehypeOptions}
        rehypePlugins={rehypePlugins}
        components={noteComponents}
      >
        {body}
      </Markdown>
    </MdxBoundary>
  );
}

type BoundaryProps = { body: string; fallback: ReactNode; children: ReactNode };
type BoundaryState = { body: string; error: Error | null };

/**
 * MDX is strict where Markdown isn't, and a note is invalid MDX for as long as
 * a tag is half-typed. When it fails to parse, say why and show the plain
 * Markdown render instead of blanking the preview.
 */
class MdxBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { body: this.props.body, error: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  // The note changed, so give the MDX another go.
  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): BoundaryState | null {
    return props.body === state.body ? null : { body: props.body, error: null };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <>
        <p
          role="alert"
          className="not-prose mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          Couldn’t render this note’s components: {error.message} Showing it as plain Markdown.
        </p>
        {this.props.fallback}
      </>
    );
  }
}
