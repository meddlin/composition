"use client";

import { defaultKeymap, history, historyKeymap, insertTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap, placeholder, type DecorationSet } from "@codemirror/view";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { findMatches, type FindOptions, type Match } from "./findMatches";
import { liveMarkdown } from "./liveMarkdown";
import { changedSpan } from "./reflowText";

/** Marks a change that came from the note changing underneath the editor, which is not the user typing. */
const fromNote = Annotation.define<boolean>();

const setFind = StateEffect.define<{ matches: readonly Match[]; current: number }>();

/** Find in note: the matches, painted behind the text, and the one being looked at in the stronger colour. */
const findHighlights = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlights, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setFind)) continue;
      const { matches, current } = effect.value;
      return Decoration.set(
        matches.map((match, index) =>
          Decoration.mark({ class: index === current ? "find-current" : "find-match" }).range(match.start, match.end),
        ),
      );
    }
    return highlights.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The editor's own look: the preview's font and spacing, the app's colours, and the caret and selection as the textarea draws them. */
const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--preview-font, inherit)", lineHeight: "1.7", overflow: "auto" },
  ".cm-content": { padding: "1rem", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--brand) 30%, transparent)",
  },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
});

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** The text can be read and copied but not changed. */
  readOnly?: boolean;
  /** Kept up to date with the caret (or selection), for the parts of the note that act on where it is. */
  selection?: RefObject<{ start: number; end: number }>;
  /** Highlights this phrase (see `findMatches`) and steps to the `current` match. */
  findQuery?: string;
  findOptions?: FindOptions;
  findCurrent?: number;
  /** Told how many matches there are whenever that changes. */
  onFindCount?: (count: number) => void;
  "aria-label"?: string;
};

const NO_OPTIONS: FindOptions = { matchCase: false, wholeWord: false };

/**
 * The note's Markdown, written and read in one place: the text is the same Markdown source the plain editor edits,
 * but drawn as it will read (see `liveMarkdown`), with the syntax showing only where the caret is. Built on CodeMirror,
 * which draws its own text, so unlike the plain editor's textarea it can hide characters without the caret losing its place.
 */
export function LiveEditor({
  value,
  onChange,
  readOnly = false,
  selection,
  findQuery = "",
  findOptions = NO_OPTIONS,
  findCurrent = 0,
  onFindCount,
  "aria-label": label = "Markdown editor",
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyFacet = useRef(new Compartment());
  // The editor is built once, so what it calls is read from here.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  });
  const initial = useRef({ value, readOnly, label });

  useEffect(() => {
    const { value: doc, readOnly: locked, label: ariaLabel } = initial.current;
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          liveMarkdown,
          findHighlights,
          editorTheme,
          placeholder("Start writing in Markdown…"),
          // Like the plain editor, Tab types a tab (for nested list items, say); Shift+Tab stays free to leave the editor.
          keymap.of([{ key: "Tab", run: insertTab }, ...defaultKeymap, ...historyKeymap]),
          readOnlyFacet.current.of(EditorState.readOnly.of(locked)),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel, spellcheck: "true" }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet && selectionRef.current) {
              const { from, to } = update.state.selection.main;
              selectionRef.current.current = { start: from, end: to };
            }
            if (!update.docChanged || update.transactions.some((t) => t.annotation(fromNote))) return;
            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyFacet.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  // The note changed under the editor (another pane, an undo elsewhere, the AI helper): take on the new text, and
  // only the part that differs, so the caret and scroll position stay put.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    const { start, end, insert } = changedSpan(current, value);
    editor.dispatch({ changes: { from: start, to: end, insert }, annotations: fromNote.of(true) });
  }, [value]);

  const matches = useMemo(() => findMatches(value, findQuery, findOptions), [value, findQuery, findOptions]);
  useEffect(() => onFindCount?.(matches.length), [onFindCount, matches.length]);

  const currentMatch = matches.length === 0 ? -1 : Math.min(findCurrent, matches.length - 1);
  const scrolledTo = useRef("");
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    // Only a different match or query moves the view; the same match shifting under typing must not.
    const key = currentMatch === -1 ? "" : `${findQuery}\u0000${findOptions.matchCase}\u0000${findOptions.wholeWord}\u0000${currentMatch}`;
    const scroll = key !== "" && key !== scrolledTo.current;
    scrolledTo.current = key;
    editor.dispatch({
      effects: [
        setFind.of({ matches, current: currentMatch }),
        ...(scroll ? [EditorView.scrollIntoView(matches[currentMatch].start, { y: "center" })] : []),
      ],
    });
  }, [matches, currentMatch, findQuery, findOptions]);

  return <div ref={host} data-testid="live-editor" className="note-pane note-surface min-h-0 flex-1 overflow-hidden" />;
}
