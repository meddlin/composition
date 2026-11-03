// Test support, not a test: lets one set of scenarios run against both editors, so a feature of the plain
// Markdown editor can't quietly be missing from the live one (see docs/live-editor-parity-plan.md).
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";
import type { Note } from "./types";

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
  select(start: number, end: number): void;
  /** Presses a key; true when nothing cancelled it, as with `fireEvent`. */
  press(key: string, init?: KeyboardEventInit): boolean;
  /** Moves focus out of the editor. */
  blur(): void;
  /** Every text the editor reported through `onChange`, in order. */
  reported: string[];
};

export type RenderOptions = {
  initial?: string;
  notes?: readonly Note[];
  noteId?: number;
};

function Harness({
  mode,
  initial = "",
  notes,
  noteId = 7,
  onValue,
}: RenderOptions & { mode: EditorMode; onValue: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
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
      view={mode}
      notes={notes}
    />
  );
}

/** Renders the editor in `mode` and returns the driver for it. */
export function renderEditor(mode: EditorMode, options: RenderOptions = {}): EditorDriver {
  const reported: string[] = [];
  const { container } = render(<Harness mode={mode} {...options} onValue={(value) => reported.push(value)} />);
  return mode === "markdown" ? textareaDriver(reported) : liveDriver(container, reported);
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
    select(start, end) {
      fireEvent.focus(el());
      el().setSelectionRange(start, end);
      fireEvent.select(el());
    },
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
          userEvent: "input.type",
        });
      });
    },
    select(start, end) {
      act(() => {
        view().contentDOM.focus();
        view().dispatch({ selection: { anchor: start, head: end } });
      });
    },
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
