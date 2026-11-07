import type { EditorView } from "@codemirror/view";
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type Ref } from "react";
import { Textarea } from "@/components/ui/textarea";
import { parse } from "@/lib/composition/frontmatter";
import { dragRatio, MAX_EDITOR_RATIO, MIN_EDITOR_RATIO } from "@/lib/composition/layout";
import { cn } from "@/lib/utils";
import { caretCoordinates } from "./caretCoordinates";
import { DrawioDialog, type DrawioSource } from "./DrawioDialog";
import { DrawioEditContext, type DrawioEditing } from "./DrawioEdit";
import { fromReactKey, useTextareaSurface, type EditorKeyEvent } from "./editorSurface";
import { panelId, tabId } from "./EditorTabs";
import { findMatches, type FindOptions, type Match } from "./findMatches";
import { FrontmatterCard } from "./FrontmatterCard";
import { ImagePickerMenu } from "./ImagePickerMenu";
import { LiveEditor, type LiveEditorEvents } from "./LiveEditor";
import { useLiveSurface } from "./liveSurface";
import { HeadingRail, RAIL_GUTTER_PX } from "./HeadingRail";
import { useLiveRail, usePreviewRail, useTextareaRail } from "./headingRails";
import { HighlightMenu, type HighlightChoice } from "./HighlightMenu";
import { highlightRange, removeHighlight, type TextRange } from "./highlightText";
import { rememberHighlightColor } from "./lastHighlightColor";
import { NoteMarkdown } from "./NoteMarkdown";
import { PreviewHighlightMenu } from "./PreviewHighlightMenu";
import { BOLD_SHORTCUT, emphasisFor, ITALIC_SHORTCUT, toggleEmphasis } from "./emphasis";
import { indentCommandFor, indentLines, INDENT_SHORTCUT, OUTDENT_SHORTCUT, type IndentEdit } from "./indentLines";
import { changedSpan, reflowAtCaret, type ReflowEdit } from "./reflowText";
import { useWriting } from "./WritingProvider";
import { wrapsBeforeColumn } from "./wrapsBeforeColumn";
import { ResizeHandle } from "./ResizeHandle";
import { MarkdownHighlight, MAX_HIGHLIGHT_CHARS, useHighlightSync } from "./MarkdownHighlight";
import { MdxCompletionMenu } from "./MdxCompletionMenu";
import { DRAWIO_SHORTCUT, diagramRange, insertDiagram, isDrawioShortcut, replaceDiagramSrc } from "./mdx/drawioSrc";
import { IMAGE_TO_MDX_SHORTCUT, imagesToMdx, isImageToMdxShortcut } from "./mdx/imageToMdx";
import { NoteLinkMenu } from "./NoteLinkMenu";
import { NoteLinksProvider, type NoteLinks } from "./NoteLink";
import type { PaneView } from "./panes";
import { useCodeHighlighting } from "./useCodeHighlighting";
import type { Note } from "./types";
import { useEditorFeatures } from "./useEditorFeatures";
import { useImageUpload } from "./useImageUpload";
import { IMAGE_PICKER_SHORTCUT } from "./useImagePicker";
import { usePreviewFind } from "./usePreviewFind";
import { NOTE_LINK_SHORTCUT } from "./useNoteLinkPicker";

/** A search within this note: what to look for, which match is being looked at, and where to report how many there are. */
export type FindState = {
  query: string;
  options: FindOptions;
  current: number;
  onCount: (count: number) => void;
};

/** What the pane around the editor can ask of it. */
export type MarkdownEditorControls = {
  /** Opens the draw.io editor to draw a diagram, which goes into the note at the caret. */
  insertDiagram: () => void;
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
  /** Which of the editor, preview and live editor to show; the first two side by side, unless told otherwise. */
  view?: PaneView;
  /** Prefix for the panels' ids, so tabs elsewhere (EditorTabs) can point at them. */
  idBase?: string;
  /** Every note, for the picker that links to one and for telling a link to a deleted note from a good one. */
  notes?: readonly Note[];
  /** Opens a note a link points at; `beside` asks for it next to this one rather than in its place. */
  onOpenNote?: (noteId: number, beside: boolean) => void;
  /** Highlights this phrase in whichever of the editor and preview are showing. */
  find?: FindState;
  /** Set to a ref to get the editor's controls (see `MarkdownEditorControls`). */
  controls?: Ref<MarkdownEditorControls>;
  /** The text can be read and copied but not changed (a note that was deleted while it is on screen). */
  readOnly?: boolean;
};

const NO_NOTES: readonly Note[] = [];

/** What the editor announces as its shortcuts: the note-link and image pickers, Image → MDX, the diagram editor, indenting lines and bold and italic. */
const KEY_SHORTCUTS = `${NOTE_LINK_SHORTCUT} ${IMAGE_PICKER_SHORTCUT} ${IMAGE_TO_MDX_SHORTCUT} ${DRAWIO_SHORTCUT} ${INDENT_SHORTCUT} ${OUTDENT_SHORTCUT} ${BOLD_SHORTCUT} ${ITALIC_SHORTCUT}`;

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
  controls,
  readOnly = false,
}: Props) {
  const writing = useWriting();
  const ownIdBase = useId();
  const ids = idBase ?? ownIdBase;
  const showEditor = view === "markdown" || view === "split";
  const showPreview = view === "preview" || view === "split";
  const showLive = view === "live";
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
  // Why a highlight or an image conversion didn't happen, and the text it was refused for: editing the note clears it.
  const [editNotice, setEditNotice] = useState<{ reason: string; value: string } | null>(null);

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

  // The writing menus (completion, the pickers, the highlight menu) and pasted images ask whichever editor is showing
  // through a surface, rather than the textarea or the live editor themselves, so that both share them.
  const liveView = useRef<EditorView | null>(null);
  const liveBox = useRef<HTMLDivElement>(null);
  const textareaSurface = useTextareaSurface(textarea, (start, end, text, caret) => {
    if (caret !== null) pendingCaret.current = start + caret;
    replaceText(start, end, text);
  });
  const liveSurface = useLiveSurface(liveView, liveBox);
  const surface = showLive ? liveSurface : textareaSurface;

  const imageUpload = useImageUpload({
    noteId,
    surface,
    readText: showLive ? () => liveSurface.text() : () => latest.current,
  });

  // The draw.io editor: opened for a new diagram (where in the note it goes) or on one already stored.
  const [diagram, setDiagram] = useState<{ source: DrawioSource; at: { start: number; end: number } } | null>(null);

  function startDiagram() {
    const text = latest.current;
    const bodyStart = text.length - parse(text)[1].length;
    const end = text.length;
    const { start, end: stop } = surface.selection();
    setDiagram({ source: { kind: "new" }, at: diagramRange(text, Math.min(start, end), Math.min(stop, end), bodyStart) });
  }
  useImperativeHandle(controls, () => ({ insertDiagram: startDiagram }));

  const drawioEditing = useMemo<DrawioEditing>(
    () => ({ edit: (name) => setDiagram({ source: { kind: "edit", name }, at: { start: 0, end: 0 } }) }),
    [],
  );

  /** The diagram was saved as stored image `name`: a new one goes in at the caret, an edited one replaces the old in every tag that showed it. */
  function diagramSaved(name: string) {
    const saved = diagram;
    setDiagram(null);
    if (!saved) return;
    const text = latest.current;
    if (saved.source.kind === "new") {
      const start = Math.min(saved.at.start, text.length);
      const edit = insertDiagram(text, start, Math.min(Math.max(saved.at.end, start), text.length), name);
      pendingCaret.current = edit.start + edit.caret;
      replaceText(edit.start, edit.end, edit.text);
      return;
    }
    const next = replaceDiagramSrc(text, saved.source.name, name);
    if (next === text) return;
    latest.current = next;
    onChange(next);
  }

  /**
   * Highlights (or un-highlights) `range`. The change goes in as typing would, so the browser's undo
   * history keeps it as one step; where that isn't possible (no `execCommand`, a hidden textarea)
   * the text is replaced and undo starts over, as it does for a pasted image.
   */
  function applyHighlight(choice: HighlightChoice, range: TextRange) {
    const el = textarea.current;
    if (!showLive && !el) return;
    const before = showLive ? liveSurface.text() : el!.value;
    const result = choice === "remove" ? removeHighlight(before, range) : highlightRange(before, range, choice);
    if (!result.ok) {
      setEditNotice({ reason: result.reason, value: before });
      return;
    }
    if (choice !== "remove") rememberHighlightColor(choice);
    setEditNotice(null);

    // Only the stretch that differs is replaced, so the scroll position and the rest of the undo stack are left alone.
    const after = result.text;
    let from = 0;
    while (from < before.length && from < after.length && before[from] === after[from]) from++;
    let tail = 0;
    while (tail < before.length - from && tail < after.length - from && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    const replacement = after.slice(from, after.length - tail);

    if (showLive) {
      // The live editor keeps its own undo history, in which this is one step.
      if (before !== after) liveSurface.replace(from, before.length - tail, replacement, null);
      liveSurface.setSelection(result.selection.start, result.selection.end);
      liveView.current?.focus();
      return;
    }
    if (!el) return;

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
  const features = useEditorFeatures({ surface, value, notes, noteId, applyHighlight });
  const { completion, imagePicker, noteLinkPicker, highlightMenu } = features;

  /**
   * Turns the Markdown image at the caret (or every one the selection touches) into an `<Image />`
   * tag, which can say how wide to be. Goes in as typing would, so undo takes it back in one step,
   * and leaves the caret ready for another prop.
   */
  function convertImagesToMdx() {
    const before = surface.text();
    const { start, end } = surface.selection();
    const edit = imagesToMdx(before, start, end);
    if (!edit) {
      setEditNotice({ reason: "Put the caret in a Markdown image, ![alt](src), or select some, to turn them into <Image /> tags.", value: before });
      return;
    }
    setEditNotice(null);

    if (showLive) {
      // The live editor keeps its own undo history, in which this is one step.
      surface.replace(edit.start, edit.end, edit.text, edit.caret);
      return;
    }
    const el = textarea.current;
    if (!el) return;
    const after = before.slice(0, edit.start) + edit.text + before.slice(edit.end);
    const caret = edit.start + edit.caret;
    el.focus();
    if (document.activeElement === el) {
      el.setSelectionRange(edit.start, edit.end);
      document.execCommand?.("insertText", false, edit.text);
    }
    if (el.value === after) {
      el.setSelectionRange(caret, caret);
      return;
    }
    pendingCaret.current = caret;
    replaceText(edit.start, edit.end, edit.text);
  }

  const noteLinks = useMemo<NoteLinks>(
    () => ({ exists: (id) => notes.some((n) => n.id === id), open: onOpenNote ?? (() => {}) }),
    [notes, onOpenNote],
  );

  const highlight = value.length <= MAX_HIGHLIGHT_CHARS;
  const highlightLayer = useHighlightSync(textarea, highlight, value);

  const previewBox = useRef<HTMLDivElement>(null);
  const railOn = writing.headingRailEnabled;
  const railSide = writing.headingRailSide;
  const editorRail = useTextareaRail(textarea, value, railOn && showEditor);
  const liveRail = useLiveRail(liveView, value, railOn && showLive);
  const previewRail = usePreviewRail(previewBox, railOn && showPreview);
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
  const [liveMatchCount, setLiveMatchCount] = useState(0);
  // Both showing is the usual case, and they agree except where Markdown syntax gets in the way; the editor leads.
  // The live editor searches the source text, as the plain editor does.
  const findCount = showLive ? liveMatchCount : showEditor ? editorMatches.length : previewMatchCount;
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

  /**
   * Reflow: a line that typing has pushed past the column is broken there. The break goes in as
   * typing would, so undo takes it back as a step of its own; where that isn't possible the text is
   * replaced and undo starts over, as it does for a pasted image.
   */
  function reflowTyping(event: ChangeEvent<HTMLTextAreaElement>) {
    if (!writing.reflowEnabled) return;
    // Only typing reflows: pasting, dropping, deleting and undoing leave the text as it is.
    if ((event.nativeEvent as InputEvent).inputType !== "insertText") return;
    const el = event.target;
    const edit = reflowAtCaret(el.value, el.selectionStart, {
      column: writing.reflowColumn,
      keepTables: writing.reflowKeepsTables,
    });
    // A pane narrower than the column has already wrapped the line on screen; a break at the column would land mid-row.
    if (edit && !wrapsBeforeColumn(el, el.selectionStart, writing.reflowColumn)) applyReflow(el, edit);
  }

  function applyReflow(el: HTMLTextAreaElement, edit: ReflowEdit) {
    const { start, end, insert } = changedSpan(el.value, edit.text);
    if (document.activeElement === el) {
      el.setSelectionRange(start, end);
      document.execCommand?.("insertText", false, insert);
    }
    if (el.value === edit.text) {
      el.setSelectionRange(edit.caret, edit.caret);
      return;
    }
    pendingCaret.current = edit.caret;
    latest.current = edit.text;
    onChange(edit.text);
  }

  /** The shortcuts and menus that work in either editor; they come ahead of the editor's own keys. */
  function handleKey(event: EditorKeyEvent) {
    if (isDrawioShortcut(event) && !event.isComposing) {
      event.preventDefault(); // Keep the browser from claiming it too (it bookmarks all tabs).
      startDiagram();
      return;
    }
    if (isImageToMdxShortcut(event) && !event.isComposing) {
      event.preventDefault(); // Keep the browser from claiming it too.
      convertImagesToMdx();
      return;
    }
    features.onKeyDown(event);
    if (event.defaultPrevented || event.isComposing || readOnly) return;
    // Cmd/Ctrl+B and Cmd/Ctrl+I over a selection: the browsers' own uses of them (bookmarks, page info) are not wanted here.
    const emphasis = emphasisFor(event);
    if (emphasis) {
      const { start, end } = surface.selection();
      const edit = toggleEmphasis(surface.text(), start, end, emphasis);
      // With nothing selected there is nothing to mark, and the key is left for the browser.
      if (!edit) return;
      event.preventDefault();
      applyEdit(edit, "input.emphasis");
      return;
    }
    // Tab over several lines, Shift+Tab over several, and Ctrl+] / Ctrl+[ anywhere: the lines move, not the selection's text.
    const { start, end } = surface.selection();
    const text = surface.text();
    const command = indentCommandFor(event, text, { start, end });
    if (!command) return;
    event.preventDefault();
    const edit = indentLines(text, start, end, command);
    if (edit) applyEdit(edit, "input.indent");
  }

  /** Swaps the span for its edited copy (indented lines, a bold selection) and reselects as the edit says. */
  function applyEdit(edit: IndentEdit, userEvent: string) {
    const view = showLive ? liveView.current : null;
    if (view) {
      view.dispatch({
        changes: { from: edit.start, to: edit.end, insert: edit.text },
        selection: { anchor: edit.selection.start, head: edit.selection.end },
        scrollIntoView: true,
        userEvent,
      });
      return;
    }
    const el = textarea.current;
    if (!el) return;
    const { start, end, insert } = changedSpan(el.value.slice(edit.start, edit.end), edit.text);
    // execCommand keeps the browser's undo history; it is missing or refused in some environments.
    el.setSelectionRange(edit.start + start, edit.start + end);
    if (document.execCommand?.("insertText", false, insert)) {
      el.setSelectionRange(edit.selection.start, edit.selection.end);
      return;
    }
    pendingSelection.current = edit.selection;
    replaceText(edit.start, edit.end, edit.text);
  }

  /** A textarea moves focus on Tab; in a writing surface it should type a tab (for nested list items, say). */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    handleKey(fromReactKey(event));
    if (event.defaultPrevented || event.key !== "Tab" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const el = event.currentTarget;
    // execCommand keeps the browser's undo history; it is missing or refused in some environments.
    if (document.execCommand?.("insertText", false, "\t")) return;
    pendingCaret.current = el.selectionStart + 1;
    replaceText(el.selectionStart, el.selectionEnd, "\t");
  }

  /** What the live editor tells the same features the textarea's own events do. */
  const liveEvents: LiveEditorEvents = {
    onKeyDown: handleKey,
    onPaste: (event) => {
      if (!readOnly) imageUpload.paste(event);
    },
    onChange: features.onChange,
    onSelect: features.onSelect,
    onScroll: features.onScroll,
    onFocus: features.onFocus,
    onBlur: features.onBlur,
  };

  const menus = (
    <>
      {imagePicker.open && <ImagePickerMenu {...imagePicker.menu} />}
      {completion.open && <MdxCompletionMenu {...completion.menu} />}
      {noteLinkPicker.open && <NoteLinkMenu {...noteLinkPicker.menu} />}
      {highlightMenu.open && <HighlightMenu {...highlightMenu.menu} />}
    </>
  );

  return (
    // Column sizes go through CSS variables. The editor stays mounted while the preview is
    // shown alone, so its caret, undo history and any image still uploading are not lost.
    <div
      ref={grid}
      style={{ "--editor-col": `${ratio}fr`, "--preview-col": `${1 - ratio}fr`, "--note-pad-left": railOn && railSide === "left" ? `${RAIL_GUTTER_PX}px` : "1rem", "--note-pad-right": railOn && railSide === "right" ? `${RAIL_GUTTER_PX}px` : "1rem" } as CSSProperties}
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
        {imageUpload.error && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {imageUpload.error}
          </p>
        )}
        {showEditor && editNotice?.value === value && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {editNotice.reason}
          </p>
        )}
        {/* The pane is the field: no border, fill the pane (not the text), and no focus ring clipped by it. */}
        <div className="note-pane relative flex min-h-0 flex-1 flex-col">
          {highlight && (
            <MarkdownHighlight text={value} layer={highlightLayer.layer} matches={editorMatches} current={currentMatch} />
          )}
          <Textarea
            ref={textarea}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              reflowTyping(e);
              features.onChange();
            }}
            readOnly={readOnly}
            onPaste={readOnly ? undefined : imageUpload.paste}
            // The text is drawn by the highlight layer, but the browser's squiggles still land on the textarea's own text.
            spellCheck
            aria-label="Markdown editor"
            placeholder="Start writing in Markdown…"
            {...features.aria}
            aria-keyshortcuts={KEY_SHORTCUTS}
            onKeyDown={onKeyDown}
            onSelect={features.onSelect}
            onFocus={features.onFocus}
            onBlur={features.onBlur}
            onScroll={() => {
              features.onScroll();
              highlightLayer.sync();
            }}
            className={cn(
              "min-h-0 flex-1 resize-none rounded-none border-0 p-4 pl-(--note-pad-left) pr-(--note-pad-right) editor-text note-surface text-sm leading-6 field-sizing-fixed focus-visible:ring-0 md:text-sm dark:bg-transparent",
              // The colours come from the layer underneath; the textarea only draws the caret and selection over it.
              highlight && "relative text-transparent caret-foreground selection:bg-brand/30 selection:text-transparent",
            )}
          />
          {writing.rulerEnabled && (
            // Clipped to the editor, so a ruler past its right edge doesn't widen the page.
            <div aria-hidden data-testid="editor-ruler" className="pointer-events-none absolute inset-0 overflow-hidden">
              {/* Measured in the editor's own characters (`ch`), after its left padding; the font and size match the textarea's. */}
              <div
                className="editor-text absolute inset-y-0 w-px bg-foreground/20 text-sm"
                style={{ left: `calc(var(--note-pad-left) + ${writing.rulerColumn}ch)` }}
              />
            </div>
          )}
          {showEditor && <HeadingRail {...editorRail} side={railSide} />}
          {!showLive && menus}
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
        className="relative flex min-h-0 flex-col"
      >
        {/* Not rendered while hidden: re-rendering Markdown on every keystroke would be wasted work. */}
        {showPreview && !showEditor && editNotice?.value === value && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {editNotice.reason}
          </p>
        )}
        {showPreview && (
          <PreviewHighlightMenu
            boxRef={previewBox}
            className="prose preview-text note-pane note-surface max-w-none flex-1 overflow-y-auto p-4 pl-(--note-pad-left) pr-(--note-pad-right)"
            text={value}
            body={body}
            onApply={applyHighlight}
          >
            {fm && <FrontmatterCard fm={fm} />}
            <NoteLinksProvider value={noteLinks}>
              <DrawioEditContext.Provider value={drawioEditing}>
                <NoteMarkdown body={body} rehypePlugins={rehypePlugins} />
              </DrawioEditContext.Provider>
            </NoteLinksProvider>
          </PreviewHighlightMenu>
        )}
        {showPreview && <HeadingRail {...previewRail} side={railSide} />}
      </section>
      <section
        role="tabpanel"
        id={panelId(ids, "live")}
        aria-labelledby={tabId(ids, "live")}
        hidden={!showLive}
        className="flex min-h-0 flex-col"
      >
        {showLive && imageUpload.error && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {imageUpload.error}
          </p>
        )}
        {showLive && editNotice?.value === value && (
          <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
            {editNotice.reason}
          </p>
        )}
        {/* Not mounted while hidden: it is a second copy of the editor, and the plain editor keeps the undo history. */}
        {showLive && (
          // The box the menus are placed in, as the plain editor's wrapper is for its own.
          <div ref={liveBox} className="relative flex min-h-0 flex-1 flex-col">
            <LiveEditor
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              onView={(editor) => {
                liveView.current = editor;
              }}
              events={liveEvents}
              attributes={{ ...features.aria, "aria-keyshortcuts": KEY_SHORTCUTS }}
              reflow={{ enabled: writing.reflowEnabled, column: writing.reflowColumn, keepTables: writing.reflowKeepsTables }}
              findQuery={findQuery}
              findOptions={findOptions}
              findCurrent={findCurrent}
              onFindCount={setLiveMatchCount}
            />
            {writing.rulerEnabled && (
              // Clipped to the editor, so a ruler past its right edge doesn't widen the page.
              <div aria-hidden data-testid="editor-ruler" className="pointer-events-none absolute inset-0 overflow-hidden">
                {/* After the editor's left padding, in the editor's own font: a column here is that many widths of a "0", which in a proportional font is only a guide. */}
                <div
                  className="preview-text absolute inset-y-0 w-px bg-foreground/20"
                  style={{ left: `calc(var(--note-pad-left) + ${writing.rulerColumn}ch)` }}
                />
              </div>
            )}
            <HeadingRail {...liveRail} side={railSide} />
            {menus}
          </div>
        )}
      </section>
      <DrawioDialog
        open={diagram !== null}
        noteId={noteId}
        source={diagram?.source ?? { kind: "new" }}
        onClose={() => setDiagram(null)}
        onSaved={diagramSaved}
      />
    </div>
  );
}
