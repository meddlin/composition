import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

/**
 * Lists, task lists and quotes in the live editor, drawn as the preview draws them (see `liveMarkdown`, which adds
 * these to its own decorations). Everything here is an inline or a line decoration, so it can come from the view
 * plugin, worked out for what is on screen.
 *
 * - A list item's `-`, `*` or `+` is drawn as a bullet and an ordered item's number as written (`3.` stays `3.`),
 *   with its indentation hidden. Each level is indented as the preview indents it, and a line that wraps hangs under
 *   the item's text.
 * - A task's `[ ]` or `[x]` is drawn as a checkbox. Clicking it toggles the `x` in the text, as one undo step, without
 *   moving the caret.
 * - A quote's lines get a bar down their left side and an indent, one bar per level, with their `> ` hidden.
 *
 * On the caret's line (or any line a selection reaches) the marks are shown as they are written, so what is being
 * typed or edited is the syntax; the line keeps its indent.
 */

/** How far each list level is indented, in the note's font size: the preview's `ul` padding plus its `li` padding. */
const LIST_INDENT = "2em";
/** How far each quote level is indented: the preview's bar plus the space after it. */
const QUOTE_INDENT = "(0.25rem + 1.25em)";
const QUOTE_BAR = "0.25rem";

type Container = { kind: "quote" } | { kind: "list"; starts: boolean; column: number };

/** What a line of a list or a quote is made of. */
type LineInfo = {
  from: number;
  to: number;
  /** The lists and quotes the line is in, outermost first. */
  containers: Container[];
  /** Where the marks at the line's start (`> `, `- `, `1. `) end; the line's start when it has none. */
  marksEnd: number;
  /** The item's mark, when an item starts on this line. */
  marker?: { text: string; ordered: boolean };
  /** The task's `[ ]` (and the space after it), when a task starts on this line. */
  task?: { from: number; to: number; checked: boolean };
};

type Span = { from: number; to: number };

/** Whether the caret, or any selection, reaches the line `from`..`to`, ends included. */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** How many spaces follow `at`, as the gap between a list mark and its text: one to four, or none at the line's end. */
function gapAfter(state: EditorState, at: number): number {
  const rest = state.doc.lineAt(at).to;
  let count = 0;
  while (at + count < rest && count < 5 && state.sliceDoc(at + count, at + count + 1) === " ") count++;
  // Five or more spaces start an indented code block; the item's text is then one space in.
  return count > 4 ? 1 : count;
}

/** Collects, line by line, what the lists and quotes inside `ranges` are made of. */
function readLines(state: EditorState, ranges: readonly Span[], frontmatterEnd: number): LineInfo[] {
  const doc = state.doc;
  const lines = new Map<number, LineInfo>();
  const lineAt = (pos: number) => {
    const line = doc.lineAt(pos);
    let info = lines.get(line.from);
    if (!info) lines.set(line.from, (info = { from: line.from, to: line.to, containers: [], marksEnd: line.from }));
    return info;
  };
  /** Each line of `from`..`to` that is also inside `range`. */
  const eachLine = (from: number, to: number, range: Span, add: (info: LineInfo) => void) => {
    const first = doc.lineAt(Math.max(from, range.from)).number;
    const last = doc.lineAt(Math.min(to, range.to)).number;
    for (let number = first; number <= last; number++) add(lineAt(doc.line(number).from));
  };

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: Math.max(range.from, frontmatterEnd),
      to: range.to,
      enter(node) {
        if (node.from < frontmatterEnd) return;
        switch (node.name) {
          case "Blockquote":
            eachLine(node.from, node.to, range, (info) => info.containers.push({ kind: "quote" }));
            return;
          case "ListItem": {
            const mark = node.node.getChild("ListMark");
            if (!mark) return;
            const first = doc.lineAt(node.from).from;
            const column = mark.to + gapAfter(state, mark.to) - first;
            eachLine(node.from, node.to, range, (info) => info.containers.push({ kind: "list", starts: info.from === first, column }));
            return;
          }
          case "ListMark": {
            const info = lineAt(node.from);
            info.marksEnd = Math.max(info.marksEnd, node.to + gapAfter(state, node.to));
            info.marker = { text: state.sliceDoc(node.from, node.to), ordered: node.node.parent?.parent?.name === "OrderedList" };
            return;
          }
          case "QuoteMark": {
            const info = lineAt(node.from);
            info.marksEnd = Math.max(info.marksEnd, node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0));
            return;
          }
          case "TaskMarker": {
            const info = lineAt(node.from);
            const gap = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
            info.task = { from: node.from, to: node.to + gap, checked: state.sliceDoc(node.from + 1, node.from + 2) !== " " };
            return;
          }
        }
      },
    });
  }
  return [...lines.values()].filter((info) => info.containers.length > 0);
}

/** Where the marks and indentation that start `info`'s line end: what is hidden while the caret is elsewhere. */
function prefixEnd(state: EditorState, info: LineInfo): number {
  let end = info.marksEnd;
  const inner = info.containers[info.containers.length - 1];
  // A line that carries on an item (its second paragraph, or a wrapped line typed with a break) is indented to the
  // item's text in the source; that indentation goes too, and no further, so an indented code block keeps its own.
  if (inner.kind === "list" && !inner.starts) {
    const limit = Math.min(info.from + inner.column, info.to);
    while (end < limit && /[ \t]/.test(state.sliceDoc(end, end + 1))) end++;
  }
  return end;
}

/** The line's indent and the bars down its left side, as a `style` attribute. */
function lineStyle(containers: readonly Container[]): string {
  const offsets: string[] = [];
  const bars: string[] = [];
  for (const container of containers) {
    const at = offsets.length === 0 ? "0px" : `calc(${offsets.join(" + ")})`;
    if (container.kind === "quote") {
      bars.push(at);
      offsets.push(QUOTE_INDENT);
    } else {
      offsets.push(LIST_INDENT);
    }
  }
  const style = [`padding-left: calc(${offsets.join(" + ")})`];
  // The line starts an item: its first row begins a level further out, where the bullet goes, and the rows it wraps
  // onto line up with the text.
  if (containers.some((container) => container.kind === "list" && container.starts)) style.push(`text-indent: -${LIST_INDENT}`);
  if (bars.length > 0) {
    style.push(
      `background-image: ${bars.map(() => "linear-gradient(var(--live-quote-bar), var(--live-quote-bar))").join(", ")}`,
      `background-position: ${bars.map((at) => `${at} 0`).join(", ")}`,
      `background-size: ${QUOTE_BAR} 100%`,
      "background-repeat: no-repeat",
    );
  }
  return style.join("; ");
}

/** A list item's bullet, or its number as written. Its source is kept in the text a screen reader reads. */
class ListMarkerWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly ordered: boolean,
  ) {
    super();
  }

  eq(other: ListMarkerWidget) {
    return this.text === other.text && this.ordered === other.ordered;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.ordered ? "cm-live-list-marker cm-live-list-number" : "cm-live-list-marker cm-live-list-bullet";
    if (this.ordered) {
      marker.textContent = this.text;
    } else {
      const source = document.createElement("span");
      source.className = "cm-live-sr-only";
      source.textContent = this.text;
      const dot = document.createElement("span");
      dot.className = "cm-live-bullet";
      dot.setAttribute("aria-hidden", "true");
      marker.append(source, dot);
    }
    return marker;
  }

  /** A click on the bullet puts the caret beside it, as one on the text would. */
  ignoreEvent() {
    return false;
  }
}

/** Marks hidden from sight (a quote's `>`s) but kept in the text a screen reader reads. */
class SourceWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: SourceWidget) {
    return this.text === other.text;
  }

  toDOM() {
    const source = document.createElement("span");
    source.className = "cm-live-sr-only";
    source.textContent = this.text;
    return source;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * The change that ticks or unticks the task whose `[ ]` starts at `from`, or null when there is none there. It is an
 * undo step of its own, never merged with typing just before it.
 */
export function toggleTask(state: EditorState, from: number): TransactionSpec | null {
  const box = /^\[([ xX])\]$/.exec(state.sliceDoc(from, from + 3));
  if (!box) return null;
  return {
    changes: { from: from + 1, to: from + 2, insert: box[1] === " " ? "x" : " " },
    annotations: isolateHistory.of("full"),
    userEvent: "input.toggle",
  };
}

/** A task's checkbox. A click toggles it in the text and leaves the caret where it was. */
class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly source: string,
  ) {
    super();
  }

  eq(other: TaskWidget) {
    return this.checked === other.checked && this.source === other.source;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = "cm-live-task";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    if (this.checked) box.classList.add("cm-live-task-checked");
    // Its name is the source, `[ ]` or `[x]`, so what a screen reader reads of the line is still what is written.
    const source = document.createElement("span");
    source.className = "cm-live-sr-only";
    source.textContent = this.source;
    box.append(source);
    box.addEventListener("mousedown", (event) => {
      // Not the editor's: the caret stays where it is, and the editor is not focused by it.
      event.preventDefault();
      if (event.button !== 0 || view.state.readOnly) return;
      const spec = toggleTask(view.state, view.posAtDOM(box));
      if (spec) view.dispatch(spec);
    });
    return box;
  }

  ignoreEvent() {
    return true;
  }
}

const hidden = Decoration.replace({});

/**
 * The decorations for the lists and quotes inside `ranges` (see `liveDecorations`): the line decorations that indent
 * them and draw the quote bars, and, away from the caret's line, the bullets, numbers and checkboxes drawn in place
 * of their marks.
 */
export function listDecorations(state: EditorState, ranges: readonly Span[], frontmatterEnd: number): Range<Decoration>[] {
  const decorations: Range<Decoration>[] = [];
  for (const info of readLines(state, ranges, frontmatterEnd)) {
    const { containers } = info;
    const classes = ["cm-live-block"];
    if (containers.some((container) => container.kind === "list")) classes.push("cm-live-list");
    if (containers.some((container) => container.kind === "quote")) classes.push("cm-live-quote");
    decorations.push(Decoration.line({ class: classes.join(" "), attributes: { style: lineStyle(containers) } }).range(info.from));

    if (touches(state, info.from, info.to)) continue;
    const end = prefixEnd(state, info);
    const inner = containers[containers.length - 1];
    if (info.marker && inner.kind === "list" && inner.starts) {
      const source = state.sliceDoc(info.from, end).trim();
      decorations.push(Decoration.replace({ widget: new ListMarkerWidget(info.marker.ordered ? info.marker.text : source, info.marker.ordered) }).range(info.from, end));
    } else if (end > info.from) {
      // A quote's `>`s are kept for a screen reader to read; bare indentation is just hidden.
      const source = state.sliceDoc(info.from, end).trim();
      decorations.push((source === "" ? hidden : Decoration.replace({ widget: new SourceWidget(source) })).range(info.from, end));
    }
    if (info.task) {
      const { from, to, checked } = info.task;
      decorations.push(Decoration.replace({ widget: new TaskWidget(checked, state.sliceDoc(from, from + 3)) }).range(from, to));
    }
  }
  return decorations;
}

/** The look of what `listDecorations` draws. Colours and sizes follow the preview's `prose`. */
export const liveListsTheme = EditorView.baseTheme({
  "&": {
    "--live-quote-bar": "color-mix(in srgb, var(--foreground) 20%, transparent)",
  },
  ".cm-live-quote": { fontStyle: "italic", fontWeight: "500" },
  // As wide as a list level, so the item's text starts one level in; the bullet or number sits at its right.
  ".cm-live-list-marker": {
    display: "inline-block",
    width: "2em",
    paddingRight: "0.375em",
    boxSizing: "border-box",
    textAlign: "right",
    textIndent: "0",
    fontStyle: "normal",
    fontWeight: "400",
  },
  ".cm-live-list-number": { color: "color-mix(in srgb, var(--foreground) 60%, transparent)" },
  ".cm-live-bullet": {
    display: "inline-block",
    width: "0.375em",
    height: "0.375em",
    borderRadius: "50%",
    verticalAlign: "0.2em",
    marginRight: "0.25em",
    backgroundColor: "color-mix(in srgb, var(--foreground) 40%, transparent)",
  },
  ".cm-live-task": {
    display: "inline-block",
    position: "relative",
    width: "0.9em",
    height: "0.9em",
    marginRight: "0.4em",
    verticalAlign: "-0.1em",
    border: "1.5px solid color-mix(in srgb, var(--foreground) 55%, transparent)",
    borderRadius: "0.2em",
    boxSizing: "border-box",
    cursor: "pointer",
    textIndent: "0",
  },
  ".cm-live-task-checked": { backgroundColor: "var(--brand)", borderColor: "var(--brand)" },
  // The tick: a rotated corner, in the page's background colour so it reads on the brand fill.
  ".cm-live-task-checked::after": {
    content: '""',
    position: "absolute",
    left: "28%",
    top: "8%",
    width: "30%",
    height: "60%",
    border: "solid var(--background)",
    borderWidth: "0 2px 2px 0",
    transform: "rotate(45deg)",
  },
  ".cm-live-sr-only": {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
