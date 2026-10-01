import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties } from "react";
import { saveImage } from "@/lib/composition/client";
import { parse } from "@/lib/composition/frontmatter";
import { imageRef, MAX_IMAGE_BYTES } from "@/lib/composition/imageRefs";
import { dragRatio, MAX_EDITOR_RATIO, MIN_EDITOR_RATIO } from "@/lib/composition/layout";
import { FrontmatterCard } from "./FrontmatterCard";
import { NoteMarkdown } from "./NoteMarkdown";
import { ResizeHandle } from "./ResizeHandle";
import { useCodeHighlighting } from "./useCodeHighlighting";

type Props = {
  /** The note being edited; pasted images are filed under its name. */
  noteId: number;
  value: string;
  onChange: (value: string) => void;
  /** The editor's share (0-1) of the editor+preview area. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: () => void;
};

const paneHeader =
  "border-b border-foreground/10 px-4 py-2 text-xs font-medium uppercase tracking-wide text-foreground/50";

/** Markdown image syntax is `![alt](path)`, so brackets in the alt text must go. */
const altTextFor = (fileName: string) => fileName.replace(/\.[^.]*$/, "").replace(/[[\]\r\n]+/g, " ").trim() || "image";

export function MarkdownEditor({ noteId, value, onChange, ratio, onRatioChange, onRatioCommit }: Props) {
  // The raw text (frontmatter included) stays in the editor; the preview shows
  // the frontmatter as a metadata card rather than as Markdown content.
  const [fm, body] = useMemo(() => parse(value), [value]);
  const rehypePlugins = useCodeHighlighting(body);

  const grid = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ ratio, width: 0 });

  const textarea = useRef<HTMLTextAreaElement>(null);
  // Uploads finish after the render that started them, so they edit the latest text, not a captured copy.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const pendingCaret = useRef<number | null>(null);
  const uploads = useRef(0);
  const [imageError, setImageError] = useState<string | null>(null);

  // A controlled textarea jumps its caret to the end when the text changes underneath it.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    textarea.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value]);

  function replaceText(start: number, end: number, text: string) {
    const next = latest.current.slice(0, start) + text + latest.current.slice(end);
    latest.current = next;
    onChange(next);
  }

  /** Swaps `placeholder` for `replacement`, keeping the caret where the user left it. */
  function resolvePlaceholder(placeholder: string, replacement: string) {
    const start = latest.current.indexOf(placeholder);
    if (start === -1) return;
    const end = start + placeholder.length;
    const el = textarea.current;
    if (el && document.activeElement === el) {
      const shift = replacement.length - placeholder.length;
      const caret = el.selectionStart;
      pendingCaret.current = caret >= end ? caret + shift : caret > start ? start + replacement.length : caret;
    }
    replaceText(start, end, replacement);
  }

  /** Puts a placeholder where the image goes, uploads in the background, and returns where the placeholder ends. */
  function insertImage(file: File, start: number, end: number): number {
    const placeholder = `[Uploading ${altTextFor(file.name)} (${++uploads.current})…]`;
    pendingCaret.current = start + placeholder.length;
    replaceText(start, end, placeholder);
    void upload(file, placeholder);
    return start + placeholder.length;
  }

  async function upload(file: File, placeholder: string) {
    let failure: string | null = null;
    let markdown = "";
    try {
      const result = await saveImage({
        noteId,
        fileName: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
      if (result.name) markdown = `![${altTextFor(file.name)}](${imageRef(result.name)})`;
      else failure = result.error ?? "Could not save the image.";
    } catch {
      failure = "Could not save the image.";
    }
    if (failure) setImageError(failure);
    resolvePlaceholder(placeholder, markdown);
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    // Cells copied from a spreadsheet arrive as text and a picture of that text; the text is what was meant.
    if (images.length === 0 || event.clipboardData.getData("text/plain") !== "") return;
    event.preventDefault();
    setImageError(null);

    const { selectionStart, selectionEnd } = event.currentTarget;
    const tooBig = images.find((file) => file.size > MAX_IMAGE_BYTES);
    if (tooBig) {
      setImageError(`Images can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    // The first replaces the selection; any others follow it.
    let at = insertImage(images[0], selectionStart, selectionEnd);
    for (const file of images.slice(1)) at = insertImage(file, at, at);
  }

  return (
    // Column sizes go through CSS variables so the panes still stack below `md`.
    <div
      ref={grid}
      style={{ "--editor-col": `${ratio}fr`, "--preview-col": `${1 - ratio}fr` } as CSSProperties}
      className="grid min-w-0 flex-1 grid-cols-1 grid-rows-2 md:grid-cols-[minmax(0,var(--editor-col))_auto_minmax(0,var(--preview-col))] md:grid-rows-1"
    >
      <section className="flex min-h-0 flex-col">
        <h2 className={paneHeader}>Markdown</h2>
        {imageError && (
          <p role="alert" className="border-b border-foreground/10 px-4 py-2 text-xs text-red-600 dark:text-red-400">
            {imageError}
          </p>
        )}
        <textarea
          ref={textarea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
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
