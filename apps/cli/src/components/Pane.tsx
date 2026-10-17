import type { SyntaxStyle, TextareaRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import { frontmatter, type Note, type panes } from "../backend";
import { markdownSpans } from "../highlight";
import { imagePathsIn, importImages } from "../imageImport";
import type { Palette } from "../theme";
import { Preview } from "./Preview";

export const AUTOSAVE_DELAY_MS = 500;

/** Lets the app save every open note before it quits. */
export type FlushRegistry = { register(flush: () => Promise<void>): () => void };

/** Image files to add at the cursor; a new `id` means a new request. */
export type ImageRequest = { id: number; files: string[] };

type PaneProps = {
  note: Note;
  /** Relative width among the open panes. */
  size: number;
  /** What to show, already narrowed to what fits (see `shownView`). */
  view: panes.PaneView;
  /** This pane has the keyboard. */
  focused: boolean;
  api: Api;
  palette: Palette;
  syntax: SyntaxStyle;
  flushes: FlushRegistry;
  /** The note as the data layer stored it after a save (its title may have changed). */
  onSaved: (note: Note) => void;
  /** Image files the app was asked to put into this note (the "insert image" dialog). */
  imageRequest?: ImageRequest | null;
  /** Something to tell the person: an image was added, or couldn't be. */
  onNotice?: (text: string) => void;
};

/**
 * One open note: its editor, its live preview, or both. The editor saves itself shortly
 * after you stop typing, and once more when the pane closes or the app quits.
 */
export function Pane({ note, size, view, focused, api, palette, syntax, flushes, onSaved, imageRequest, onNotice }: PaneProps) {
  const editor = useRef<TextareaRenderable | null>(null);
  // The textarea owns the text from the moment it is created; later renders must not reset it.
  const initial = useRef(note.content);
  const savedContent = useRef(note.content);
  const latest = useRef(note.content);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "failed">("saved");
  const [text, setText] = useState(note.content);

  const currentText = () => editor.current?.plainText ?? latest.current;

  const highlight = () => {
    const box = editor.current;
    if (!box) return;
    box.clearAllHighlights();
    for (const span of markdownSpans(box.plainText)) {
      const styleId = syntax.getStyleId(span.style);
      if (styleId !== null) box.addHighlight(span.line, { start: span.start, end: span.end, styleId });
    }
  };

  const save = async () => {
    timer.current = null;
    const content = currentText();
    if (content === savedContent.current) {
      setStatus("saved");
      return;
    }
    try {
      const stored = await api.saveNoteContent(note.id, content);
      savedContent.current = content;
      onSaved(stored);
      setStatus(currentText() === content ? "saved" : "saving");
    } catch {
      setStatus("failed");
    }
  };

  /** Called after anything that might have changed the text, including undo and redo. */
  const check = () => {
    const content = currentText();
    latest.current = content;
    if (content === savedContent.current) return;
    setStatus("saving");
    setText(content);
    highlight();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  };

  useEffect(() => {
    highlight();
    const unregister = flushes.register(async () => {
      if (timer.current) clearTimeout(timer.current);
      await save();
    });
    return () => {
      unregister();
      if (timer.current) clearTimeout(timer.current);
      // The pane is going away (closed, or its note was replaced): don't lose the last edit.
      if (latest.current !== savedContent.current) void api.saveNoteContent(note.id, latest.current);
    };
  }, []);

  /** Stores the image files and writes their Markdown at the cursor, replacing a selection. */
  const addImages = async (files: readonly string[]) => {
    const { markdown, errors } = await importImages(api, note.id, files);
    if (markdown !== "") {
      editor.current?.insertText(markdown);
      check();
    }
    const added = markdown === "" ? 0 : markdown.split("\n").length;
    const parts = [added > 0 ? `Added ${added} image${added === 1 ? "" : "s"}.` : "", ...errors];
    if (parts.some(Boolean)) onNotice?.(parts.filter(Boolean).join(" "));
  };

  const lastRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!imageRequest || imageRequest.id === lastRequest.current) return;
    lastRequest.current = imageRequest.id;
    void addImages(imageRequest.files);
  }, [imageRequest?.id]);

  // A new color scheme means new style ids; the old highlights would point at the old ones.
  useEffect(() => {
    highlight();
  }, [syntax]);

  const showEditor = view !== "preview";
  const showPreview = view !== "markdown";
  const [, body] = frontmatter.parse(text);
  const statusText = status === "saved" ? "saved" : status === "saving" ? "saving…" : "not saved";
  const viewLabel = view === "markdown" ? "editor" : view;

  return (
    <box
      flexGrow={size}
      flexBasis={0}
      flexDirection="column"
      border
      borderStyle="single"
      borderColor={focused ? palette.borderFocused : palette.border}
      backgroundColor={palette.surface}
      title={` ${note.title} — ${statusText} · ${viewLabel} `}
    >
      <box flexDirection="row" flexGrow={1}>
        <box flexGrow={1} flexBasis={0} visible={showEditor} paddingLeft={1} paddingRight={1}>
          <textarea
            ref={editor}
            focused={focused && showEditor}
            initialValue={initial.current}
            wrapMode="word"
            showCursor
            syntaxStyle={syntax}
            backgroundColor={palette.surface}
            textColor={palette.foreground}
            focusedBackgroundColor={palette.surface}
            focusedTextColor={palette.foreground}
            // OpenTUI's undo and redo are ctrl+- and ctrl+.; these are the ones people expect.
            keyBindings={[
              { name: "z", ctrl: true, action: "undo" },
              { name: "y", ctrl: true, action: "redo" },
            ]}
            onContentChange={check}
            // A terminal cannot paste a picture, but dragging an image file into it pastes the file's
            // path. Paths that are all image files become images; any other paste is typed as text.
            onPaste={(event) => {
              const files = imagePathsIn(new TextDecoder().decode(event.bytes), process.cwd());
              if (!files) return;
              event.preventDefault();
              void addImages(files).catch((error) => onNotice?.(`That didn't work: ${error instanceof Error ? error.message : String(error)}`));
            }}
            // Undo and redo change the text without telling onContentChange, so look after every key.
            onKeyDown={(key) => {
              // A bare Tab types a tab, so nested list items can be indented, as in the web editor.
              // Shift+Tab is left alone.
              if (key.name === "tab" && !key.shift && !key.ctrl && !key.meta) {
                key.preventDefault();
                editor.current?.insertText("\t");
              }
              setTimeout(check, 0);
            }}
          />
        </box>
        <box flexGrow={1} flexBasis={0} visible={showPreview} paddingLeft={1} paddingRight={1}>
          <scrollbox focused={focused && !showEditor}>
            <Preview body={body} palette={palette} syntax={syntax} api={api} />
          </scrollbox>
        </box>
      </box>
    </box>
  );
}
