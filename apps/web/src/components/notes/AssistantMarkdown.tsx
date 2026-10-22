"use client";

import { useDeferredValue } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * What a model's answer is drawn with. It is untrusted text, so this is deliberately not `NoteMarkdown`, which
 * loads any https image by itself (a way for a steered model to send a note's text to another site in the image's
 * address) and understands a note's own components and links. Here an image is only its alt text, a link is text
 * with its address in a tooltip and cannot be followed, and HTML is shown as text (react-markdown does not render
 * it unless a plugin asks it to, and none does).
 */
const components: Components = {
  img: ({ alt }) => <span className="italic text-muted-foreground">[image{alt ? `: ${alt}` : ""}]</span>,
  a: ({ href, children }) => (
    <span title={typeof href === "string" ? href : undefined} className="underline decoration-dotted underline-offset-2">
      {children}
    </span>
  ),
};

export function AssistantMarkdown({ text }: { text: string }) {
  // While an answer streams, drawing every token would be wasted work; React catches up between keystrokes.
  const shown = useDeferredValue(text);
  return (
    <div className="prose prose-sm max-w-none break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {shown}
      </Markdown>
    </div>
  );
}
