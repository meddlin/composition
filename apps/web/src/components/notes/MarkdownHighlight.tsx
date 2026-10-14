import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { tokenizeMarkdown } from "./markdownTokens";

/** Past this the layer is dropped and the text is left plain: re-colouring a huge note on every keystroke would lag typing. */
export const MAX_HIGHLIGHT_CHARS = 100_000;

/**
 * The editor's colours, drawn underneath its textarea. The textarea keeps the caret, selection,
 * undo and input handling and draws its text transparent; this draws the same text in colour.
 * It therefore has to lay the text out exactly as the textarea does (same font, padding and
 * wrapping), and use only colour to tell tokens apart, since a heavier or wider glyph would
 * push everything after it out of line.
 */
export function MarkdownHighlight({ text, layer }: { text: string; layer: RefObject<HTMLDivElement | null> }) {
  const segments = useMemo(() => tokenizeMarkdown(text), [text]);
  return (
    // Windows high-contrast mode forces the textarea's text visible, so the layer would only double it.
    <div ref={layer} aria-hidden className="pointer-events-none absolute inset-y-0 left-0 select-none overflow-hidden forced-colors:hidden">
      <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6">
        {segments.map((segment, index) =>
          segment.kind ? (
            <span key={index} className={`md-${segment.kind}`}>
              {segment.text}
            </span>
          ) : (
            segment.text
          ),
        )}
        {/* A final newline leaves an empty last line in the textarea, which a pre would not give height. */}
        {"​"}
      </pre>
    </div>
  );
}

function alignLayer(el: HTMLTextAreaElement | null, box: HTMLDivElement | null) {
  if (!el || !box) return;
  box.style.right = `${el.offsetWidth - el.clientWidth}px`;
  box.scrollTop = el.scrollTop;
  box.scrollLeft = el.scrollLeft;
}

/**
 * Keeps the layer lined up with the textarea it sits under: scrolled the same, and as wide as the
 * textarea's text area (a classic scrollbar narrows the textarea's lines, so it must narrow the layer's too).
 * Call `sync` whenever the textarea scrolls; it also runs by itself when the text or the textarea's size changes.
 */
export function useHighlightSync(textarea: RefObject<HTMLTextAreaElement | null>, enabled: boolean, value: string) {
  const layer = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => alignLayer(textarea.current, layer.current), [textarea, enabled, value]);

  useEffect(() => {
    const el = textarea.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => alignLayer(el, layer.current));
    observer.observe(el);
    return () => observer.disconnect();
  }, [textarea, enabled]);

  return { layer, sync: () => alignLayer(textarea.current, layer.current) };
}
