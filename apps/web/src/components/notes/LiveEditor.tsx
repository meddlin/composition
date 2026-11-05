"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap, placeholder, type DecorationSet } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { fromNativeKey, type EditorKeyEvent } from "./editorSurface";
import { findMatches, type FindOptions, type Match } from "./findMatches";
import { liveMarkdown } from "./liveMarkdown";
import { liveReflow } from "./liveReflow";
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
  ".cm-content": { padding: "1rem var(--note-pad-right, 1rem) 1rem var(--note-pad-left, 1rem)", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--brand) 30%, transparent)",
  },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
});

/** Types a tab at the caret, or over the selection. */
function typeTab(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  view.dispatch(view.state.replaceSelection("\t"), { scrollIntoView: true, userEvent: "input" });
  return true;
}

/**
 * What the editor tells the note's writing features (the menus, pasted images) as things happen in it. They get a
 * key before the editor's own keymap does, so a menu that is open has Enter, Tab and the arrows to itself, and
 * a handler that calls `preventDefault` has handled the event.
 */
export type LiveEditorEvents = {
  onKeyDown(event: EditorKeyEvent): void;
  onPaste(event: ClipboardEvent): void;
  /** Typing (or any change that is not the note changing underneath the editor). */
  onChange(): void;
  /** The caret or selection moved, or the text changed. */
  onSelect(): void;
  onScroll(): void;
  onFocus(): void;
  onBlur(): void;
};

/** The editor's attributes on top of its label: what the menus are, for assistive tech. Undefined ones are left off. */
type Attributes = Record<string, string | undefined>;

const contentAttributes = (label: string, attributes: Attributes) =>
  EditorView.contentAttributes.of({
    "aria-label": label,
    spellcheck: "true",
    ...(Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined)) as Record<string, string>),
  });

/** Breaking lines as they are typed past a column (see `liveReflow`); off unless `enabled`. */
export type LiveReflow = { enabled: boolean; column: number; keepTables: boolean };

const NO_REFLOW: LiveReflow = { enabled: false, column: 80, keepTables: true };

const reflowExtension = ({ enabled, column, keepTables }: LiveReflow) => (enabled ? liveReflow({ column, keepTables }) : []);

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** The text can be read and copied but not changed. */
  readOnly?: boolean;
  /** Given the editor's view once it is built, and null when it is taken away. */
  onView?: (view: EditorView | null) => void;
  events?: LiveEditorEvents;
  attributes?: Attributes;
  reflow?: LiveReflow;
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
  onView,
  events,
  attributes,
  reflow = NO_REFLOW,
  findQuery = "",
  findOptions = NO_OPTIONS,
  findCurrent = 0,
  onFindCount,
  "aria-label": label = "Markdown editor",
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyFacet = useRef(new Compartment());
  const attributesFacet = useRef(new Compartment());
  const reflowFacet = useRef(new Compartment());
  // The editor is built once, so what it calls is read from here.
  const onChangeRef = useRef(onChange);
  const eventsRef = useRef(events);
  const onViewRef = useRef(onView);
  useEffect(() => {
    onChangeRef.current = onChange;
    eventsRef.current = events;
    onViewRef.current = onView;
  });
  const initial = useRef({ value, readOnly, label, attributes: attributes ?? {}, reflow });

  useEffect(() => {
    const { value: doc, readOnly: locked, label: ariaLabel, attributes: ariaAttributes, reflow: initialReflow } = initial.current;
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
          // Like the plain editor, Tab types a tab in place of whatever is selected (for nested list items, say);
          // Shift+Tab stays free to leave the editor. (CodeMirror's own `insertTab` indents a selection instead.)
          keymap.of([{ key: "Tab", run: typeTab }, ...defaultKeymap, ...historyKeymap]),
          // Ahead of the keymap (and the Markdown one, whose Enter continues a list): an open menu is told first.
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (event) => {
                eventsRef.current?.onKeyDown(fromNativeKey(event));
                return event.defaultPrevented;
              },
              paste: (event) => {
                eventsRef.current?.onPaste(event);
                return event.defaultPrevented;
              },
            }),
          ),
          EditorView.domEventObservers({
            focus: () => eventsRef.current?.onFocus(),
            blur: () => eventsRef.current?.onBlur(),
          }),
          readOnlyFacet.current.of(EditorState.readOnly.of(locked)),
          attributesFacet.current.of(contentAttributes(ariaLabel, ariaAttributes)),
          reflowFacet.current.of(reflowExtension(initialReflow)),
          EditorView.updateListener.of((update) => {
            const typed = update.docChanged && !update.transactions.some((t) => t.annotation(fromNote));
            if (typed) {
              onChangeRef.current(update.state.doc.toString());
              eventsRef.current?.onChange();
            }
            if (update.selectionSet || update.docChanged) eventsRef.current?.onSelect();
          }),
        ],
      }),
    });
    view.current = editor;
    onViewRef.current?.(editor);
    const onScroll = () => eventsRef.current?.onScroll();
    editor.scrollDOM.addEventListener("scroll", onScroll);
    return () => {
      editor.scrollDOM.removeEventListener("scroll", onScroll);
      onViewRef.current?.(null);
      editor.destroy();
      view.current = null;
    };
  }, []);

  const { enabled: reflowEnabled, column: reflowColumn, keepTables: reflowKeepsTables } = reflow;
  useEffect(() => {
    view.current?.dispatch({
      effects: reflowFacet.current.reconfigure(reflowExtension({ enabled: reflowEnabled, column: reflowColumn, keepTables: reflowKeepsTables })),
    });
  }, [reflowEnabled, reflowColumn, reflowKeepsTables]);

  const attributesKey = JSON.stringify(attributes ?? {});
  useEffect(() => {
    view.current?.dispatch({ effects: attributesFacet.current.reconfigure(contentAttributes(label, JSON.parse(attributesKey) as Attributes)) });
  }, [label, attributesKey]);

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
