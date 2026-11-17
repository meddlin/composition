import { syntaxTree } from "@codemirror/language";
import { Facet, Prec, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { parse } from "@/lib/composition/frontmatter";
import { deadLink, followLink, fragmentOffset, linkTarget, NO_NOTE_LINKS, openInNewTab, webHref, type NoteLinks } from "./noteLinkActions";

/**
 * Links in the Live editor (decision D2 of docs/live-default-plan.md). Away from the caret, `[text](url "title")` is
 * drawn as its text, underlined in the link colour, with `[` and `](url "title")` hidden and the address as its
 * tooltip; autolinks (`<https://…>`) and bare addresses are drawn as links too. With the caret in a link its marks
 * show, dimmed, so the text and the address are edited as any Markdown is.
 *
 * A plain click puts the caret in the link, as in any text. Cmd/Ctrl+click follows it (`followLink`, which the
 * preview shares), and Cmd/Ctrl+Shift+click opens a note beside this one. While Cmd/Ctrl is held a link shows the
 * pointer, so it reads as something to click.
 */

/** Whether notes and PDFs exist, and how to open them: the app's, handed to the editor (see `LiveEditor`'s `links`). */
export const noteLinksFacet = Facet.define<NoteLinks, NoteLinks>({ combine: (values) => values[0] ?? NO_NOTE_LINKS });

/** A node of the Markdown syntax tree (its package is not one of ours to import from). */
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

const hidden = Decoration.replace({});
const syntax = Decoration.mark({ class: "cm-live-syntax" });

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The key that, held, makes a click follow a link: Cmd on a Mac (where Ctrl+click is the context menu), Ctrl elsewhere. */
function followKeyHeld(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

const FOLLOW_HINT = isMac ? "⌘-click to follow" : "Ctrl+click to follow";

function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** The text of a link's label as Markdown matches it to a definition: case and runs of space don't count. */
const normalLabel = (label: string) => label.slice(1, -1).trim().replace(/\s+/g, " ").toLowerCase();

type Definition = { url: string; title: string };

/** The note's `[label]: url "title"` definitions, from the syntax tree's top level, by label. */
function definitionsOf(state: EditorState): Map<string, Definition> {
  const found = new Map<string, Definition>();
  for (let block = syntaxTree(state).topNode.firstChild; block; block = block.nextSibling) {
    if (block.name !== "LinkReference") continue;
    const label = block.getChild("LinkLabel");
    const url = block.getChild("URL");
    if (!label || !url) continue;
    const key = normalLabel(state.sliceDoc(label.from, label.to));
    const title = block.getChild("LinkTitle");
    // The first definition of a label is the one that counts.
    if (!found.has(key)) found.set(key, { url: state.sliceDoc(url.from, url.to), title: title ? state.sliceDoc(title.from + 1, title.to - 1) : "" });
  }
  return found;
}

/** A link's address as written, made into one to follow: `<…>` taken off, a bare `www.` given `http://`, an email `mailto:`. */
function hrefOf(url: string, bare: boolean): string {
  const address = url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(address)) return address;
  if (address.includes("@")) return `mailto:${address}`;
  return `http://${address}`;
}

/** The constructs whose address is theirs to draw (or not), rather than a bare one in the text. */
const OWNS_URL = new Set(["Link", "Image", "Autolink", "LinkReference"]);

/** How a link is drawn, by what it points at; `dead` says why it goes nowhere. */
function linkMark(href: string, title: string, links: NoteLinks): Decoration {
  const dead = deadLink(linkTarget(href), links);
  const tooltip = dead ?? `${title ? `${title}\n` : ""}${href}\n${FOLLOW_HINT}`;
  return Decoration.mark({
    class: dead ? "cm-live-link cm-live-link-dead" : "cm-live-link",
    attributes: { title: tooltip, "data-href": href },
  });
}

/**
 * Reads the definitions only when a link needs them, once per redraw: most notes have none, and finding them walks
 * the whole tree's top level.
 */
export type LinkContext = { links: NoteLinks; definitions: () => Map<string, Definition> };

export function linkContext(state: EditorState): LinkContext {
  let definitions: Map<string, Definition> | null = null;
  return { links: state.facet(noteLinksFacet), definitions: () => (definitions ??= definitionsOf(state)) };
}

/** Hides `from`..`to`, or, where it runs over a line break (which a plugin may not hide), dims it instead. */
function hide(state: EditorState, decorations: Range<Decoration>[], from: number, to: number) {
  if (from >= to) return;
  decorations.push((state.sliceDoc(from, to).includes("\n") ? syntax : hidden).range(from, to));
}

/**
 * The decorations for one `Link`, `Autolink` or bare `URL` node, or false when the node is not a link this draws
 * (an image's address, a definition's, a `[text]` with no definition). Its children are still walked by the caller,
 * so bold inside a link's text is bold.
 */
export function drawLink(state: EditorState, node: SyntaxNode, context: LinkContext, decorations: Range<Decoration>[]): boolean {
  if (node.name === "URL") {
    // A bare address. One inside a link, an image or a definition is that construct's, drawn with it.
    if (!node.parent || OWNS_URL.has(node.parent.name)) return false;
    const url = state.sliceDoc(node.from, node.to);
    decorations.push(linkMark(hrefOf(url, true), "", context.links).range(node.from, node.to));
    return true;
  }

  if (node.name === "Autolink") {
    const url = node.getChild("URL");
    if (!url) return false;
    decorations.push(linkMark(hrefOf(state.sliceDoc(url.from, url.to), true), "", context.links).range(url.from, url.to));
    const active = touches(state, node.from, node.to);
    for (const [from, to] of [[node.from, url.from], [url.to, node.to]]) {
      if (active) decorations.push(syntax.range(from, to));
      else hide(state, decorations, from, to);
    }
    return true;
  }

  // A `Link`: `[` text `]` then `(url "title")`, `[label]`, or nothing (`[label]` on its own).
  const marks = node.getChildren("LinkMark");
  if (marks.length < 2 || marks[0].from !== node.from) return false;
  const [open, close] = marks;
  const url = node.getChild("URL");
  const title = node.getChild("LinkTitle");
  let href: string;
  let tip = "";
  if (url) {
    href = hrefOf(state.sliceDoc(url.from, url.to), false);
    if (title) tip = state.sliceDoc(title.from + 1, title.to - 1);
  } else {
    // `[text][label]` names its definition; `[text][]` and `[text]` are named by their text.
    const label = node.getChild("LinkLabel");
    const labelText = label ? state.sliceDoc(label.from, label.to) : "";
    const definition = context.definitions().get(normalLabel(labelText.length > 2 ? labelText : state.sliceDoc(open.from, close.to)));
    if (!definition) return false;
    href = hrefOf(definition.url, false);
    tip = definition.title;
  }
  // `[](url)` has no text to draw it as: left as written.
  if (open.to >= close.from) return false;

  decorations.push(linkMark(href, tip, context.links).range(open.to, close.from));
  if (touches(state, node.from, node.to)) {
    // Being edited: the brackets show, dimmed, and the address keeps the colour the plain editor gives it.
    for (const mark of marks) decorations.push(syntax.range(mark.from, mark.to));
  } else {
    hide(state, decorations, open.from, open.to);
    hide(state, decorations, close.from, node.to);
  }
  return true;
}

/** Follows the link `href`, read from a click in `view` (see `followLink`). */
export function followFromLive(view: EditorView, href: string, beside: boolean) {
  followLink(linkTarget(href), view.state.facet(noteLinksFacet), {
    beside,
    scrollTo: (id) => {
      const text = view.state.doc.toString();
      const at = fragmentOffset(text, id, text.length - parse(text)[1].length);
      if (at !== null) view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 16 }) });
    },
    openWeb: (web) => {
      if (webHref(web)) openInNewTab(web);
    },
  });
}

/** Cmd/Ctrl+click on a drawn link follows it, before CodeMirror moves the caret there. */
const followOnClick = Prec.high(
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !followKeyHeld(event)) return false;
      const link = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-href]") : null;
      if (!link || !view.contentDOM.contains(link)) return false;
      event.preventDefault();
      followFromLive(view, link.dataset.href ?? "", event.shiftKey);
      return true;
    },
  }),
);

/** The class that, on the scroller, gives links the pointer: on while Cmd/Ctrl is held. */
const FOLLOWING = "cm-live-following";

const pointerWhileHeld = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      window.addEventListener("keydown", this.onKey);
      window.addEventListener("keyup", this.onKey);
      window.addEventListener("blur", this.onBlur);
      view.scrollDOM.addEventListener("mousemove", this.onKey);
    }
    // Moving the mouse says too: Cmd may have been pressed while another window had the keys.
    onKey = (event: KeyboardEvent | MouseEvent) => this.view.scrollDOM.classList.toggle(FOLLOWING, followKeyHeld(event));
    onBlur = () => this.view.scrollDOM.classList.remove(FOLLOWING);
    destroy() {
      window.removeEventListener("keydown", this.onKey);
      window.removeEventListener("keyup", this.onKey);
      window.removeEventListener("blur", this.onBlur);
      this.view.scrollDOM.removeEventListener("mousemove", this.onKey);
    }
  },
);

const linkTheme = EditorView.baseTheme({
  ".cm-live-link": {
    color: "var(--link)",
    textDecoration: "underline",
    textDecorationColor: "color-mix(in srgb, var(--link) 50%, transparent)",
    textUnderlineOffset: "0.15em",
  },
  // The plain editor's colours for a link's text and address would otherwise win inside the link's own.
  ".cm-live-link .md-link, .cm-live-link .md-url": { color: "inherit" },
  ".cm-live-link-dead": { color: "var(--muted-foreground)", textDecoration: "line-through" },
  ".cm-scroller.cm-live-following .cm-live-link:not(.cm-live-link-dead)": { cursor: "pointer" },
});

/** Following links, and how they look; the drawing itself is `drawLink`, called from `liveDecorations`. */
export const liveLinks: Extension = [followOnClick, pointerWhileHeld, linkTheme];
