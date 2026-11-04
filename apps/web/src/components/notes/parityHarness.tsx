// Test support, not a test: lets one set of scenarios run against both editors, so a feature of the plain
// Markdown editor can't quietly be missing from the live one (see docs/live-editor-parity-plan.md).
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type Ref } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { DEFAULT_WRITING_SETTINGS, type WritingSettings } from "@/lib/composition/writing";
import { MarkdownEditor, type MarkdownEditorControls } from "./MarkdownEditor";
import type { Note } from "./types";
import { WritingProvider } from "./WritingProvider";

// jsdom does no layout, and CodeMirror asks the browser where text is whenever it scrolls or draws a selection.
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

export type EditorMode = "markdown" | "live";
export const EDITOR_MODES: readonly EditorMode[] = ["markdown", "live"];

/** One editor on screen, driven the way a person would: typing, selecting, pressing keys, leaving. */
export type EditorDriver = {
  mode: EditorMode;
  /** The element that has the caret and the focus: the textarea, or the live editor's text. */
  element(): HTMLElement;
  /** The note's text as the editor holds it. */
  text(): string;
  selection(): { start: number; end: number };
  /** Where the caret is (the start of the selection). */
  caret(): number;
  /** Makes the text `text` with the caret at `caret` (default: the end), as typing that ends there would. */
  type(text: string, caret?: number): void;
  /** Types `text` a character at a time, after what is there, the way a keyboard does (each one a typed character, not a paste). */
  typeKeys(text: string): void;
  select(start: number, end: number): void;
  /** Puts the caret in the editor, as clicking into it would. */
  focus(): void;
  /** Pastes `files` (and `text`, if any); true when nothing cancelled the paste, as with `fireEvent`. */
  paste(files: File[], text?: string): boolean;
  /** Presses a key; true when nothing cancelled it, as with `fireEvent`. */
  press(key: string, init?: KeyboardEventInit): boolean;
  /** Moves focus out of the editor. */
  blur(): void;
  /** Every text the editor reported through `onChange`, in order. */
  reported: string[];
};

export type RenderOptions = {
  /** What the Markdown editor shows beside the text: both editor and preview (the default), as the app starts a note. The live editor has no other view. */
  view?: "split" | "markdown" | "preview";
  initial?: string;
  notes?: readonly Note[];
  noteId?: number;
  /** Set to a ref to get the editor's controls, as the pane around it does. */
  controls?: Ref<MarkdownEditorControls>;
  /** The ruler and reflow settings (Settings > Writing), on top of the defaults, which have both off. */
  writing?: Partial<WritingSettings>;
};

function Harness({
  mode,
  view = "split",
  initial = "",
  notes,
  noteId = 7,
  controls,
  writing,
  onValue,
}: RenderOptions & { mode: EditorMode; onValue: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <WritingProvider value={{ ...DEFAULT_WRITING_SETTINGS, ...writing }}>
    <MarkdownEditor
      noteId={noteId}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
      ratio={0.5}
      onRatioChange={vi.fn()}
      onRatioCommit={vi.fn()}
      view={mode === "live" ? "live" : view}
      notes={notes}
      controls={controls}
    />
    </WritingProvider>
  );
}

/** Renders the editor in `mode` and returns the driver for it. */
export function renderEditor(mode: EditorMode, options: RenderOptions = {}): EditorDriver {
  const reported: string[] = [];
  const { container } = render(<Harness mode={mode} {...options} onValue={(value) => reported.push(value)} />);
  return mode === "markdown" ? textareaDriver(reported) : liveDriver(container, reported);
}

/** What a paste carries, as `fireEvent.paste` takes it. */
const clipboard = (files: File[], text: string) => ({
  clipboardData: { files, getData: (type: string) => (type === "text/plain" ? text : "") },
});

/** Types `marked` with the caret where its `|` is (no `|` means the end), as typing that ends there would. */
export function typeMarked(editor: EditorDriver, marked: string) {
  const at = marked.indexOf("|");
  const text = at === -1 ? marked : marked.slice(0, at) + marked.slice(at + 1);
  editor.type(text, at === -1 ? text.length : at);
}

function textareaDriver(reported: string[]): EditorDriver {
  const el = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
  return {
    mode: "markdown",
    reported,
    element: el,
    text: () => el().value,
    selection: () => ({ start: el().selectionStart, end: el().selectionEnd }),
    caret: () => el().selectionStart,
    type(text, caret = text.length) {
      fireEvent.focus(el());
      fireEvent.change(el(), { target: { value: text, selectionStart: caret, selectionEnd: caret } });
    },
    typeKeys(text) {
      for (const char of text) {
        const next = el().value + char;
        fireEvent.input(el(), { target: { value: next }, inputType: "insertText", data: char });
        // A change that does not come from typing leaves the caret where the browser put it, at the end.
        if (el().selectionStart === el().value.length - 1) el().setSelectionRange(el().value.length, el().value.length);
      }
    },
    select(start, end) {
      fireEvent.focus(el());
      el().setSelectionRange(start, end);
      fireEvent.select(el());
    },
    focus: () => fireEvent.focus(el()),
    paste: (files, text = "") => fireEvent.paste(el(), clipboard(files, text)),
    press: (key, init) => fireEvent.keyDown(el(), { key, ...init }),
    blur: () => fireEvent.blur(el()),
  };
}

function liveDriver(container: HTMLElement, reported: string[]): EditorDriver {
  const view = () => EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  return {
    mode: "live",
    reported,
    element: () => view().contentDOM,
    text: () => view().state.doc.toString(),
    selection: () => ({ start: view().state.selection.main.from, end: view().state.selection.main.to }),
    caret: () => view().state.selection.main.from,
    type(text, caret = text.length) {
      act(() => {
        view().contentDOM.focus();
        view().dispatch({
          changes: { from: 0, to: view().state.doc.length, insert: text },
          selection: { anchor: caret },
          // Replacing the whole text is an edit, not a keystroke: it must not be reflowed as typing is.
          userEvent: "input",
        });
      });
    },
    typeKeys(text) {
      act(() => {
        view().contentDOM.focus();
        view().dispatch({ selection: { anchor: view().state.doc.length } });
        for (const char of text) {
          const at = view().state.selection.main.head;
          view().dispatch({ changes: { from: at, insert: char }, selection: { anchor: at + char.length }, userEvent: "input.type" });
        }
      });
    },
    select(start, end) {
      act(() => {
        view().contentDOM.focus();
        view().dispatch({ selection: { anchor: start, head: end } });
      });
    },
    focus: () => act(() => view().contentDOM.focus()),
    paste: (files, text = "") => fireEvent.paste(view().contentDOM, clipboard(files, text)),
    press: (key, init) => fireEvent.keyDown(view().contentDOM, { key, ...init }),
    blur: () => fireEvent.blur(view().contentDOM),
  };
}

/** What a scenario is given: a way to put the editor under test on screen. */
export type ParityContext = { render(options?: RenderOptions): EditorDriver; mode: EditorMode };

type ScenarioOptions = {
  /**
   * The live editor can't do this yet, and this says which step of the plan will add it. The scenario runs there
   * expecting to fail, so it turns red the moment the feature arrives: take this off then.
   */
  pendingInLive?: string;
};

/**
 * Runs the scenarios under it once for each editor, the plain Markdown one and the live one. A scenario that is
 * the same in both is written once; one that differs on purpose checks `mode` and says why.
 */
export function describeParity(
  title: string,
  define: (scenario: (name: string, body: (context: ParityContext) => void | Promise<void>, options?: ScenarioOptions) => void) => void,
) {
  for (const mode of EDITOR_MODES) {
    describe(`${title} (${mode} editor)`, () => {
      afterEach(cleanup);
      define((name, body, { pendingInLive } = {}) => {
        const run = () => body({ mode, render: (options) => renderEditor(mode, options) });
        if (mode === "live" && pendingInLive !== undefined) it.fails(`${name} [pending in live: ${pendingInLive}]`, run);
        else it(name, run);
      });
    });
  }
}
