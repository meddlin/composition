import { Facet } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import { useLayoutEffect, useMemo, useSyncExternalStore, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DrawioEditContext, type DrawioEditing } from "./DrawioEdit";
import { NoteLinksProvider, type NoteLinks } from "./NoteLink";
import { NoteMarkdown } from "./NoteMarkdown";
import { SheetEditContext, type SheetEditing } from "./SheetEdit";

/**
 * What a block drawn in the Live tab needs from the editor around it: the same things Preview hands its
 * `NoteMarkdown` (see `MarkdownEditor`), so a block draws, links and edits as it does there.
 */
export type LiveBlockContext = {
  noteLinks?: NoteLinks;
  drawio?: DrawioEditing | null;
  /** Null where the note can't be changed (it is read only), as in Preview. */
  sheet?: SheetEditing | null;
};

/**
 * Holds the `LiveBlockContext` for one editor. The editor is built once, but what its blocks need (the list of notes,
 * the editing callbacks) changes as the app re-renders, so the blocks' React roots read it from here and redraw when
 * it is replaced. Nothing else of a block redraws it.
 */
export class LiveBlockHost {
  private context: LiveBlockContext = {};
  private readonly listeners = new Set<() => void>();

  readonly get = (): LiveBlockContext => this.context;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  set(context: LiveBlockContext) {
    if (context === this.context) return;
    this.context = context;
    for (const listener of this.listeners) listener();
  }
}

/** The editor's block host; an editor without one draws its blocks with Preview's defaults (links that do nothing, no Edit buttons). */
export const liveBlockHost = Facet.define<LiveBlockHost, LiveBlockHost>({
  combine: (hosts) => hosts[0] ?? new LiveBlockHost(),
});

/** Where a drawn block's source starts in the document now, and where the note's body starts (after the frontmatter). */
export type BlockPlace = { start: number; bodyStart: number };

/** A kind of block the Live tab draws whole, by the syntax-tree node that writes it. */
export type BlockKind = {
  /** The node's name in the Markdown syntax tree (`Table`, `HTMLBlock`). */
  node: string;
  /**
   * Whether the drawing handles its own clicks (a sheet's grid, a video player). Such a block gets a small "Edit
   * source" button that puts the caret in its source; any other is edited by clicking anywhere on it.
   */
  ownsClicks?: boolean;
  /** Whether this node's text is one of these blocks (an HTML block that is a `<Sheet>`, say). All are, if not given. */
  accepts?: (source: string) => boolean;
  /**
   * Draws the block in place of `NoteMarkdown` (inside the same providers), for a block that needs more of the note
   * than its own source: `<Toc>` (the note's headings), `<Footnotes>` and the frontmatter card.
   */
  Drawing?: ComponentType<{ source: string; view: EditorView }>;
};

const NO_REHYPE: never[] = [];
const NO_LINKS: NoteLinks = { exists: () => true, open: () => {} };

/** The React roots of the blocks on screen, by the element they draw into. */
const roots = new WeakMap<HTMLElement, Root>();

type ViewProps = {
  host: LiveBlockHost;
  source: string;
  kind: BlockKind;
  view: EditorView;
  /** Where the block is now, read when a component in it needs a position in the note (a sheet's Edit). */
  place: () => BlockPlace | null;
  /** Called once the drawing is in the page, so the editor measures it. */
  drawn: () => void;
};

/** A block's source drawn as Preview draws it, inside Preview's providers. */
function BlockView({ host, source, kind, view, place, drawn }: ViewProps) {
  const { noteLinks, drawio = null, sheet = null } = useSyncExternalStore(host.subscribe, host.get, host.get);
  // A sheet's Edit says where its tag starts in what was drawn, which here is the block; the editor wants the note's body.
  const sheetEditing = useMemo<SheetEditing | null>(() => {
    if (!sheet) return null;
    const inBody = (offset: number) => {
      const at = place();
      return at ? at.start - at.bodyStart + offset : offset;
    };
    return { edit: (offset) => sheet.edit(inBody(offset)), reimport: (offset) => sheet.reimport(inBody(offset)) };
  }, [sheet, place]);
  useLayoutEffect(drawn);
  return (
    <NoteLinksProvider value={noteLinks ?? NO_LINKS}>
      <DrawioEditContext.Provider value={drawio}>
        <SheetEditContext.Provider value={sheetEditing}>
          {kind.Drawing ? <kind.Drawing source={source} view={view} /> : <NoteMarkdown body={source} rehypePlugins={NO_REHYPE} />}
        </SheetEditContext.Provider>
      </DrawioEditContext.Provider>
    </NoteLinksProvider>
  );
}

/**
 * A block (a table, an MDX component) drawn in place of its source, or under it while the caret is in it (`beside`),
 * by Preview's own `NoteMarkdown` in a React root of its own. Two widgets with the same source are the same drawing,
 * so typing elsewhere in the note leaves it alone; a new source redraws the root that is there.
 */
export class BlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly kind: BlockKind,
    readonly beside: boolean,
    /** Where the block is now; see `blockPlace`. */
    readonly place: (view: EditorView, dom: HTMLElement) => BlockPlace | null,
  ) {
    super();
  }

  eq(other: BlockWidget) {
    return this.source === other.source && this.beside === other.beside && this.kind === other.kind;
  }

  /** A guess at the drawn height, until it is measured: a table's rows are a little taller than its source lines. */
  get estimatedHeight() {
    let lines = 1;
    for (let at = this.source.indexOf("\n"); at !== -1; at = this.source.indexOf("\n", at + 1)) lines++;
    return lines * 36 + 16;
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    const body = document.createElement("div");
    body.className = "cm-live-block-body prose preview-text max-w-none";
    dom.append(body);

    const edit = () => {
      const at = this.place(view, dom);
      if (!at) return;
      view.dispatch({ selection: { anchor: at.start }, scrollIntoView: true, userEvent: "select.pointer" });
      view.focus();
    };
    if (this.kind.ownsClicks) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-live-block-edit";
      button.textContent = "Edit source";
      // On mousedown, so the editor keeps focus and the caret lands before the click would move it.
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        edit();
      });
      // From the keyboard (or a screen reader's activate), which sends a click with no mousedown.
      button.addEventListener("click", (event) => {
        if (event.detail === 0) edit();
      });
      dom.append(button);
    } else {
      dom.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || this.beside) return;
        // A modified click on a link in the drawing is the link's (Preview's NoteAnchor follows it).
        if ((event.metaKey || event.ctrlKey) && (event.target as Element).closest?.("a")) return;
        event.preventDefault();
        edit();
      });
    }

    this.paint(dom);
    const root = createRoot(body);
    roots.set(body, root);
    this.render(root, view, dom);
    return dom;
  }

  updateDOM(dom: HTMLElement, view: EditorView) {
    const body = dom.firstElementChild as HTMLElement | null;
    const root = body && roots.get(body);
    // Another kind of block has its own buttons and handlers: build it afresh.
    if (!root || dom.dataset.kind !== this.kind.node || dom.dataset.ownsClicks !== String(!!this.kind.ownsClicks)) return false;
    this.paint(dom);
    this.render(root, view, dom);
    return true;
  }

  /** The wrapper's classes and what assistive tech is told: the drawing under its own source is a repeat, so it is hidden from them. */
  private paint(dom: HTMLElement) {
    dom.className = `cm-live-block${this.beside ? " cm-live-block-beside" : ""}${this.kind.ownsClicks ? " cm-live-block-owns-clicks" : ""}`;
    dom.dataset.kind = this.kind.node;
    dom.dataset.ownsClicks = String(!!this.kind.ownsClicks);
    if (this.beside) dom.setAttribute("aria-hidden", "true");
    else dom.removeAttribute("aria-hidden");
  }

  private render(root: Root, view: EditorView, dom: HTMLElement) {
    root.render(
      <BlockView
        host={view.state.facet(liveBlockHost)}
        source={this.source}
        kind={this.kind}
        view={view}
        place={() => this.place(view, dom)}
        drawn={() => view.requestMeasure()}
      />,
    );
  }

  destroy(dom: HTMLElement) {
    const body = dom.firstElementChild as HTMLElement | null;
    const root = body && roots.get(body);
    if (!root) return;
    roots.delete(body);
    // Not now: the editor may be updating from inside a React effect, where unmounting another root is refused.
    queueMicrotask(() => root.unmount());
  }

  /** Clicks, drags and keys in a drawing are its own (see `toDOM`): the editor leaves them alone. */
  ignoreEvent() {
    return true;
  }
}
