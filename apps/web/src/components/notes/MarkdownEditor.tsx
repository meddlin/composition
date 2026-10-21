import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { saveImage } from "@/lib/composition/client";
import { parse } from "@/lib/composition/frontmatter";
import { imageRef } from "@/lib/composition/imageRefs";
import { maxImageBytes } from "@/lib/composition/imageLimit";
import { dragRatio, MAX_EDITOR_RATIO, MIN_EDITOR_RATIO } from "@/lib/composition/layout";
import { cn } from "@/lib/utils";
import { caretCoordinates } from "./caretCoordinates";
import { panelId, tabId } from "./EditorTabs";
import { findMatches, type FindOptions, type Match } from "./findMatches";
import { FrontmatterCard } from "./FrontmatterCard";
import { ImagePickerMenu } from "./ImagePickerMenu";
import { HighlightMenu, type HighlightChoice } from "./HighlightMenu";
import { highlightRange, removeHighlight, type TextRange } from "./highlightText";
import { rememberHighlightColor } from "./lastHighlightColor";
import { NoteMarkdown } from "./NoteMarkdown";
import { PreviewHighlightMenu } from "./PreviewHighlightMenu";
import { ResizeHandle } from "./ResizeHandle";
import { MarkdownHighlight, MAX_HIGHLIGHT_CHARS, useHighlightSync } from "./MarkdownHighlight";
import { MdxCompletionMenu } from "./MdxCompletionMenu";
import { NoteLinkMenu } from "./NoteLinkMenu";
import { NoteLinksProvider, type NoteLinks } from "./NoteLink";
import type { PaneView } from "./panes";
import { useCodeHighlighting } from "./useCodeHighlighting";
import { useHighlightMenu } from "./useHighlightMenu";
import { useImagePicker } from "./useImagePicker";
import type { Note } from "./types";
import { usePreviewFind } from "./usePreviewFind";
import { useMdxCompletion } from "./useMdxCompletion";
import { NOTE_LINK_SHORTCUT, useNoteLinkPicker } from "./useNoteLinkPicker";

/** A search within this note: what to look for, which match is being looked at, and where to report how many there are. */
export type FindState = {
  query: string;
  options: FindOptions;
  current: number;
  onCount: (count: number) => void;
};

const NO_MATCHES: Match[] = [];

type Props = {
  /** The note being edited; pasted images are filed under its name. */
  noteId: number;
  value: string;
  onChange: (value: string) => void;
  /** The editor's share (0-1) of the editor+preview area. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  onRatioCommit: () => void;
  /** Which of the editor and preview to show; both, side by side, unless told otherwise. */
  view?: PaneView;
  /** Prefix for the panels' ids, so tabs elsewhere (EditorTabs) can point at them. */
  idBase?: string;
  /** Every note, for the picker that links to one and for telling a link to a deleted note from a good one. */
  notes?: readonly Note[];
  /** Opens a note a link points at; `beside` asks for it next to this one rather than in its place. */
  onOpenNote?: (noteId: number, beside: boolean) => void;
  /** Highlights this phrase in whichever of the editor and preview are showing. */
  find?: FindState;
};

const NO_NOTES: readonly Note[] = [];

/** Markdown image syntax is `![alt](path)`, so brackets in the alt text must go. */
const altTextFor = (fileName: string) => fileName.replace(/\.[^.]*$/, "").replace(/[[\]\r\n]+/g, " ").trim() || "image";

export function MarkdownEditor({
  noteId,
  value,
  onChange,
  ratio,
  onRatioChange,
  onRatioCommit,
  view = "split",
  idBase,
  notes = NO_NOTES,
  onOpenNote,
  find,
}: Props) {
  const ownIdBase = useId();
  const ids = idBase ?? ownIdBase;
  const showEditor = view !== "preview";
  const showPreview = view !== "markdown";
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
  const pendingSelection = useRef<TextRange | null>(null);
  const uploads = useRef(0);
  const [imageError, setImageError] = useState<string | null>(null);
  // Why a highlight was refused, and the text it was refused for: editing the note clears it.
  const [highlightError, setHighlightError] = useState<{ reason: string; value: string } | null>(null);

  // A controlled textarea jumps its caret to the end when the text changes underneath it.
  useLayoutEffect(() => {
    if (pendingSelection.current) {
      textarea.current?.setSelectionRange(pendingSelection.current.start, pendingSelection.current.end);
      pendingSelection.current = null;
    }
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

  const completion = useMdxCompletion(textarea, value, (start, end, text, caret) => {
    pendingCaret.current = start + caret;
    replaceText(start, end, text);
  });

  const imagePicker = useImagePicker(textarea, value, (start, end, text, caret) => {
    pendingCaret.current = start + caret;
    replaceText(start, end, text);
  });

  const noteLinkPicker = useNoteLinkPicker(textarea, value, notes, noteId, (start, end, text, caret) => {
    pendingCaret.current = start + caret;
    replaceText(start, end, text);
  });

  /**
   * Highlights (or un-highlights) `range`. The change goes in as typing would, so the browser's undo
   * history keeps it as one step; where that isn't possible (no `execCommand`, a hidden textarea)
   * the text is replaced and undo starts over, as it does for a pasted image.
   */
  function applyHighlight(choice: HighlightChoice, range: TextRange) {
    const el = textarea.current;
    if (!el) return;
    const before = el.value;
    const result = choice === "remove" ? removeHighlight(before, range) : highlightRange(before, range, choice);
    if (!result.ok) {
      setHighlightError({ reason: result.reason, value: before });
      return;
    }
    if (choice !== "remove") rememberHighlightColor(choice);
    setHighlightError(null);

    // Only the stretch that differs is replaced, so the scroll position and the rest of the undo stack are left alone.
    const after = result.text;
    let from = 0;
    while (from < before.length && from < after.length && before[from] === after[from]) from++;
    let tail = 0;
    while (tail < before.length - from && tail < after.length - from && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    const replacement = after.slice(from, after.length - tail);

    if (before !== after) {
      el.focus();
      // A hidden editor (the preview alone is showing) can't take focus, and execCommand would then
      // type into whatever else has it.
      if (document.activeElement === el) {
        el.setSelectionRange(from, before.length - tail);
        document.execCommand?.("insertText", false, replacement);
      }
      if (el.value !== after) {
        pendingSelection.current = result.selection;
        replaceText(from, before.length - tail, replacement);
        return;
      }
    }
    el.setSelectionRange(result.selection.start, result.selection.end);
  }
  const highlightMenu = useHighlightMenu(textarea, applyHighlight);

  const noteLinks = useMemo<NoteLinks>(
    () => ({ exists: (id) => notes.some((n) => n.id === id), open: onOpenNote ?? (() => {}) }),
    [notes, onOpenNote],
  );

  const highlight = value.length <= MAX_HIGHLIGHT_CHARS;
  const highlightLayer = useHighlightSync(textarea, highlight, value);

  const previewBox = useRef<HTMLDivElement>(null);
  const findQuery = find?.query ?? "";
  const findCurrent = find?.current ?? 0;
  const matchCase = find?.options.matchCase ?? false;
  const wholeWord = find?.options.wholeWord ?? false;
  const onFindCount = find?.onCount;
  const findOptions = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);
  // The editor is searched as source text, frontmatter and Markdown syntax included; the preview as it renders.
  const editorMatches = useMemo(
    () => (showEditor ? findMatches(value, findQuery, findOptions) : NO_MATCHES),
    [showEditor, value, findQuery, findOptions],
  );
  const previewMatchCount = usePreviewFind(previewBox, showPreview && findQuery !== "", findQuery, findOptions, findCurrent);
  // Both showing is the usual case, and they agree except where Markdown syntax gets in the way; the editor leads.
  const findCount = showEditor ? editorMatches.length : previewMatchCount;
  useEffect(() => onFindCount?.(findCount), [onFindCount, findCount]);

  const currentMatch = editorMatches.length === 0 ? -1 : Math.min(findCurrent, editorMatches.length - 1);
  const scrolledTo = useRef("");
  useEffect(() => {
    const el = textarea.current;
    if (currentMatch === -1 || !el) {
      scrolledTo.current = "";
      return;
    }
    // Only a different match or query moves the view; the same match shifting under typing must not.
    const key = `${findQuery}\u0000${matchCase}\u0000${wholeWord}\u0000${currentMatch}`;
    if (scrolledTo.current === key) return;
    scrolledTo.current = key;
    const { top, height } = caretCoordinates(el, editorMatches[currentMatch].start);
    if (top < el.scrollTop || top + height > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
  }, [editorMatches, currentMatch, findQuery, matchCase, wholeWord]);

  /** A textarea moves focus on Tab; in a writing surface it should type a tab (for nested list items, say). */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // The menus take Tab while one is open. Shift+Tab stays free so the keyboard can still leave the editor.
    // The image picker comes first: it swallows every key while open, which a menu opened by typing must not see.
    if (imagePicker.open || !noteLinkPicker.open) imagePicker.textareaProps.onKeyDown(event);
    if (event.defaultPrevented) return;
    noteLinkPicker.textareaProps.onKeyDown(event);
    if (event.defaultPrevented) return;
    completion.textareaProps.onKeyDown(event);
    if (event.defaultPrevented) return;
    highlightMenu.textareaProps.onKeyDown(event);
    if (event.defaultPrevented || event.key !== "Tab" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const el = event.currentTarget;
    // execCommand keeps the browser's undo history; it is missing or refused in some environments.
    if (document.execCommand?.("insertText", false, "\t")) return;
    pendingCaret.current = el.selectionStart + 1;
    replaceText(el.selectionStart, el.selectionEnd, "\t");
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    // Cells copied from a spreadsheet arrive as text and a picture of that text; the text is what was meant.
    if (images.length === 0 || event.clipboardData.getData("text/plain") !== "") return;
    event.preventDefault();
    setImageError(null);

    const { selectionStart, selectionEnd } = event.currentTarget;
    const limit = maxImageBytes;
    if (limit !== null && images.some((file) => file.size > limit)) {
      setImageError(`Images can be at most ${limit / (1024 * 1024)} MB.`);
      return;
    }
    // The first replaces the selection; any others follow it.
    let at = insertImage(images[0], selectionStart, selectionEnd);
    for (const file of images.slice(1)) at = insertImage(file, at, at);
  }

  return (
    // Column sizes go through CSS variables. The editor stays mounted while the preview is
    // shown alone, so its caret, undo history and any image still uploading are not lost.
    <div
      ref={grid}
      style={{ "--editor-col": `${ratio}fr`, "--preview-col": `${1 - ratio}fr` } as CSSProperties}
      className={cn(
        "grid min-h-0 min-w-0 flex-1 grid-rows-1",
        view === "split" ? "grid-cols-[minmax(0,var(--editor-col))_auto_minmax(0,var(--preview-col))]" : "grid-cols-1",
      )}
    >
      <section
        role="tabpanel"
        id={panelId(ids, "markdown")}
        aria-labelledby={tabId(ids, "markdown")}
        hidden={!showEditor}
        className="flex min-h-0 flex-col"
      >
        {imageError && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {imageError}
          </p>
        )}
        {showEditor && highlightError?.value === value && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {highlightError.reason}
          </p>
        )}
        {/* The pane is the field: no border, fill the pane (not the text), and no focus ring clipped by it. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {highlight && (
            <MarkdownHighlight text={value} layer={highlightLayer.layer} matches={editorMatches} current={currentMatch} />
          )}
          <Textarea
            ref={textarea}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              completion.sync(e.target);
              noteLinkPicker.sync(e.target);
            }}
            onPaste={onPaste}
            // The text is drawn by the highlight layer, but the browser's squiggles still land on the textarea's own text.
            spellCheck
            aria-label="Markdown editor"
            placeholder="Start writing in Markdown…"
            {...completion.textareaProps}
            aria-controls={
              imagePicker.textareaProps["aria-controls"] ??
              completion.textareaProps["aria-controls"] ??
              noteLinkPicker.textareaProps["aria-controls"] ??
              highlightMenu.textareaProps["aria-controls"]
            }
            aria-activedescendant={
              imagePicker.textareaProps["aria-activedescendant"] ??
              completion.textareaProps["aria-activedescendant"] ??
              noteLinkPicker.textareaProps["aria-activedescendant"] ??
              highlightMenu.textareaProps["aria-activedescendant"]
            }
            aria-keyshortcuts={`${NOTE_LINK_SHORTCUT} ${imagePicker.textareaProps["aria-keyshortcuts"]}`}
            onKeyDown={onKeyDown}
            onSelect={(event) => {
              imagePicker.textareaProps.onSelect(event);
              completion.textareaProps.onSelect(event);
              noteLinkPicker.textareaProps.onSelect(event);
              highlightMenu.textareaProps.onSelect(event);
            }}
            onFocus={(event) => {
              completion.textareaProps.onFocus(event);
              noteLinkPicker.textareaProps.onFocus(event);
            }}
            onBlur={() => {
              imagePicker.textareaProps.onBlur();
              completion.textareaProps.onBlur();
              noteLinkPicker.textareaProps.onBlur();
              highlightMenu.textareaProps.onBlur();
            }}
            onScroll={(event) => {
              imagePicker.textareaProps.onScroll(event);
              completion.textareaProps.onScroll(event);
              noteLinkPicker.textareaProps.onScroll(event);
              highlightMenu.textareaProps.onScroll();
              highlightLayer.sync();
            }}
            className={cn(
              "min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm leading-6 field-sizing-fixed focus-visible:ring-0 md:text-sm dark:bg-transparent",
              // The colours come from the layer underneath; the textarea only draws the caret and selection over it.
              highlight && "relative text-transparent caret-foreground selection:bg-brand/30 selection:text-transparent",
            )}
          />
          {imagePicker.open && <ImagePickerMenu {...imagePicker.menu} />}
          {completion.open && <MdxCompletionMenu {...completion.menu} />}
          {noteLinkPicker.open && <NoteLinkMenu {...noteLinkPicker.menu} />}
          {highlightMenu.open && <HighlightMenu {...highlightMenu.menu} />}
        </div>
      </section>
      {view === "split" && (
        <ResizeHandle
          label="Resize editor and preview"
          valueNow={Math.round(ratio * 100)}
          valueMin={MIN_EDITOR_RATIO * 100}
          valueMax={MAX_EDITOR_RATIO * 100}
          onResizeStart={() => {
            dragStart.current = { ratio, width: grid.current?.getBoundingClientRect().width ?? 0 };
          }}
          onResize={(dx) => onRatioChange(dragRatio(dragStart.current.ratio, dx, dragStart.current.width))}
          onResizeEnd={onRatioCommit}
        />
      )}
      <section
        role="tabpanel"
        id={panelId(ids, "preview")}
        aria-labelledby={tabId(ids, "preview")}
        hidden={!showPreview}
        className="flex min-h-0 flex-col"
      >
        {/* Not rendered while hidden: re-rendering Markdown on every keystroke would be wasted work. */}
        {showPreview && !showEditor && highlightError?.value === value && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {highlightError.reason}
          </p>
        )}
        {showPreview && (
          <PreviewHighlightMenu
            boxRef={previewBox}
            className="prose preview-text max-w-none flex-1 overflow-y-auto p-4"
            text={value}
            body={body}
            onApply={applyHighlight}
          >
            {fm && <FrontmatterCard fm={fm} />}
            <NoteLinksProvider value={noteLinks}>
              <NoteMarkdown body={body} rehypePlugins={rehypePlugins} />
            </NoteLinksProvider>
          </PreviewHighlightMenu>
        )}
      </section>
    </div>
  );
}
