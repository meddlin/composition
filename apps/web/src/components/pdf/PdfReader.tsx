"use client";

import "pdfjs-dist/web/pdf_viewer.css";
import {
  BookmarkPlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  Link2Icon,
  MoonIcon,
  NotebookPenIcon,
  PanelLeftIcon,
  Redo2Icon,
  SearchIcon,
  StickyNoteIcon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
  MoveHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useElementWidth } from "../notes/useElementWidth";
import type { PdfAnnotation, PdfCitation, PdfDocument, PdfTextState } from "@/lib/composition/documentsApi";
import type { DocumentsStore } from "@/lib/composition/documentsStore";
import { pageCitation, quoteBlock } from "@/lib/composition/pdfRefs";
import { cn } from "@/lib/utils";
import type { Insertion } from "../notes/noteInsertions";
import type { PdfGoTo } from "../panels/kinds";
import { ExportPdfDialog } from "./ExportPdfDialog";
import { MarkLayers, usePageLayers } from "./PdfMarkLayers";
import { BookmarkList, HighlightList, NotesList, OutlineTree, pageName, type SidebarTab } from "./PdfSidebar";
import { SelectionToolbar } from "./SelectionToolbar";
import { useMarkEditing } from "./useMarkEditing";
import { PdfPasswordDialog } from "./PdfPasswordDialog";
import { usePdfViewer, type PdfViewer } from "./usePdfViewer";

/** How wide the panel must be for the outline and bookmarks to sit beside the pages rather than over them. */
const SIDEBAR_BESIDE_MIN_WIDTH = 600;

/** How long the mark a followed link names is drawn attention to. */
const FLASH_MS = 1600;

/** How the reader works with the notes beside it: where its citations go, who cites it, and what a followed link asked of it. */
export type PdfPairing = {
  /** What a citation calls the PDF: the title of its own note. */
  title: string;
  /** The PDF's own note, then every note that links to it. */
  citations: PdfCitation[];
  /** The note Quote and Cite this page write to, and its title; null when there is none to write to. */
  noteId: number | null;
  noteTitle: string | null;
  /** Whether the pairing follows the note in use rather than staying with one. */
  follow: boolean;
  /** A followed link's ask: the reader shows it once it is open, then says so with `onGoToDone`. */
  goTo?: PdfGoTo;
  /** Puts Markdown into the paired note; false when it is not there to write to. */
  insert: (markdown: string, how: Insertion) => boolean;
  onToggleFollow: () => void;
  onOpenNote: (noteId: number) => void;
  onNewNote: () => void;
  onGoToDone: (seq: number) => void;
};

/**
 * A PDF being read: the pages (drawn by pdf.js as they scroll into view), and above them a bar with the page, the zoom,
 * find, the dark-pages toggle and a bookmark button, with the outline and bookmarks in a sidebar. Where the reader was,
 * its zoom and the dark-pages choice are remembered for the PDF. `onTitle` hears the title the PDF gives itself, if it has one
 * worth showing, for the note that owns it to take (the workspace decides whether the note still wants one).
 */
export function PdfReader({ document, documents, pairing, onTitle }: { document: PdfDocument; documents: DocumentsStore; pairing?: PdfPairing; onTitle?: (title: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  // A narrow panel has no room for the sidebar beside the pages, so there it covers them until it is put away.
  const narrow = useElementWidth(root) < SIDEBAR_BESIDE_MIN_WIDTH;
  const [dark, setDark] = useState(document.viewState.darkPages === true);
  const [sidebar, setSidebar] = useState<SidebarTab | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  /** The words of the last search result opened here (the request's `seq` tells a new one from it): the find bar opens with them. */
  const [findAsked, setFindAsked] = useState<{ query: string; seq: number } | null>(null);
  /** Where this PDF's text is in search: a scan's outline says it has none. */
  const [textState, setTextState] = useState<PdfTextState | null>(null);
  useEffect(() => {
    let current = true;
    void documents.pdfTextState(document.id).then((state) => current && setTextState(state));
    return () => {
      current = false;
    };
  }, [documents, document.id]);
  const [bookmarksRead, setBookmarksRead] = useState(0);

  const viewer = usePdfViewer(container, pages, {
    documentId: document.id,
    viewState: { ...document.viewState, darkPages: dark },
    onPageCount: useCallback((count: number) => documents.setPageCount(document.id, count), [documents, document.id]),
    onTitle,
    // A PDF opened with a password earlier this session is not asked about again; the one typed is kept in memory only (the store).
    password: documents.passwordFor(document.id),
    onPassword: useCallback((password: string) => documents.rememberPassword(document.id, password), [documents, document.id]),
    onViewState: useCallback((state) => documents.saveViewState(document.id, state), [documents, document.id]),
  });

  // Cancelling the password box leaves the panel saying the PDF is protected, with a button that asks again.
  const [passwordDismissed, setPasswordDismissed] = useState(false);

  function toggleDark() {
    const next = !dark;
    setDark(next);
    const known = documents.byId(document.id)?.viewState ?? document.viewState;
    documents.saveViewState(document.id, { ...known, darkPages: next });
  }

  const ready = viewer.phase === "ready" ? viewer : null;
  const edit = useMarkEditing({ pdf: document, documents, controls: ready?.controls ?? null, container });
  const layers = usePageLayers(ready?.controls ?? null);

  // Exporting a copy with the marks in it: the dialog asks about flattening, then the native save dialog opens and the copy is written
  // out of the main process, so the reader says when it is under way and how it went.
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  // Quote and Cite this page write into the paired note, and say so when there is none.
  const [notice, setNotice] = useState<string | null>(null);
  async function exportPdf(flatten: boolean) {
    setExportOpen(false);
    setExported(null);
    setNotice(null);
    setExporting(true);
    // A PDF that needed a password is exported with it: the main process unlocks the file with it, and protects the copy the same way.
    const password = documents.passwordFor(document.id);
    const result = await documents.exportDocument(document.id, { flatten, ...(password === undefined ? {} : { password }) });
    setExporting(false);
    if ("error" in result) return setNotice(result.error);
    if ("canceled" in result) return;
    const left = [
      result.skipped.ink > 0 && `${result.skipped.ink} ink ${result.skipped.ink === 1 ? "mark was" : "marks were"} left out (ink is not exported yet).`,
      result.skipped.offPage > 0 && `${result.skipped.offPage} ${result.skipped.offPage === 1 ? "mark" : "marks"} on a page this PDF does not have ${result.skipped.offPage === 1 ? "was" : "were"} left out.`,
    ].filter(Boolean);
    setExported([`Saved “${result.fileName}” with ${result.written} ${result.written === 1 ? "mark" : "marks"}.`, result.passwordProtected && "The copy is protected with the same password.", ...left].filter(Boolean).join(" "));
  }
  function put(markdown: string, how: Insertion) {
    if (!pairing) return;
    if (pairing.noteId === null) return setNotice("Open a note beside this PDF to write in.");
    setNotice(pairing.insert(markdown, how) ? null : "That note is no longer there to write in.");
  }
  const cite = { uuid: document.uuid, title: pairing?.title ?? "" };
  function quote(mark: PdfAnnotation) {
    if (ready && mark.quote !== "") put(quoteBlock(cite, mark.quote, mark.page + 1, mark.uuid, ready.labels), "block");
  }
  function citePage() {
    if (ready) put(pageCitation(cite, ready.page, ready.labels), "inline");
  }
  const quotedIn = useMemo(() => {
    const titles = new Map<string, string[]>();
    for (const citation of pairing?.citations ?? []) {
      for (const mark of citation.marks) titles.set(mark, [...(titles.get(mark) ?? []), citation.title.trim() || "Untitled"]);
    }
    return (uuid: string) => titles.get(uuid) ?? [];
  }, [pairing?.citations]);

  // A followed link asks for a page, and perhaps a mark on it: shown once, when the PDF is open and its marks are known.
  const goTo = pairing?.goTo;
  const goToDone = useRef(pairing?.onGoToDone);
  useEffect(() => {
    goToDone.current = pairing?.onGoToDone;
  });
  const shown = useRef(0);
  const marksKnown = edit.status !== "loading";
  useEffect(() => {
    if (!goTo || !ready || !marksKnown || shown.current === goTo.seq) return;
    shown.current = goTo.seq;
    const mark = goTo.mark === null ? undefined : edit.marks.find((m) => m.uuid === goTo.mark);
    const rect = mark?.rects?.[0] ?? (mark?.body as { rect?: [number, number, number, number] } | null | undefined)?.rect;
    if (mark && rect) ready.controls.goToRect(mark.page + 1, rect);
    else ready.controls.goToPage(Math.min(goTo.page, ready.pageCount));
    // A search result found in the PDF's text: pdf.js finds its words from this page on (the find bar is opened with them below).
    if (goTo.find) ready.controls.find(goTo.find);
    // The mark keeps its flash for a moment, then the ask is dropped.
    const seq = goTo.seq;
    window.setTimeout(() => goToDone.current?.(seq), FLASH_MS);
  }, [goTo, ready, marksKnown, edit.marks]);
  const flashId = goTo?.mark ? (edit.marks.find((m) => m.uuid === goTo.mark)?.id ?? null) : null;
  // A new request with words to find opens the find bar with them (state adjusted while rendering, not in an effect).
  if (goTo?.find && goTo.seq !== findAsked?.seq) {
    setFindAsked({ query: goTo.find, seq: goTo.seq });
    setFindOpen(true);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (edit.onKeyDown(event)) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFindOpen(true);
    }
  }

  return (
    <div ref={root} className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <Toolbar
        viewer={viewer}
        dark={dark}
        onToggleDark={toggleDark}
        sidebar={sidebar}
        onToggleSidebar={() => setSidebar(sidebar === null ? "outline" : null)}
        findOpen={findOpen}
        onToggleFind={() => setFindOpen(!findOpen)}
        canUndo={edit.canUndo}
        canRedo={edit.canRedo}
        onUndo={edit.undo}
        onRedo={edit.redo}
        placing={edit.placing}
        onTogglePlacing={edit.togglePlacing}
        exporting={exporting}
        onExport={() => setExportOpen(true)}
        paired={pairing ? { follow: pairing.follow, noteTitle: pairing.noteTitle, onToggleFollow: pairing.onToggleFollow, onCite: citePage } : null}
        onAddBookmark={() => {
          if (!ready) return;
          void documents.addBookmark(document.id, ready.page - 1, "").then(() => {
            setBookmarksRead((n) => n + 1);
            setSidebar("bookmarks");
          });
        }}
      />
      {(edit.error ?? notice) && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b bg-destructive/10 px-3 py-1 text-sm text-destructive">
          <span className="flex-1">{edit.error ?? notice}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            onClick={() => {
              edit.clearError();
              setNotice(null);
            }}
          >
            <XIcon />
          </Button>
        </div>
      )}
      {(exporting || exported) && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b bg-muted px-3 py-1 text-sm">
          <span className="flex-1">{exporting ? "Exporting…" : exported}</span>
          {!exporting && (
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setExported(null)}>
              <XIcon />
            </Button>
          )}
        </div>
      )}
      <ExportPdfDialog open={exportOpen} onOpenChange={setExportOpen} onExport={(flatten) => void exportPdf(flatten)} protectedByPassword={documents.passwordFor(document.id) !== undefined} />
      {ready && findOpen && <FindBar key={findAsked?.seq ?? 0} viewer={ready} initialQuery={findAsked?.query ?? ""} onClose={() => { setFindOpen(false); ready.controls.closeFind(); }} />}
      <div className="relative flex min-h-0 flex-1">
        {sidebar !== null && (
          <aside
            aria-label="PDF sidebar"
            className={cn("flex w-60 shrink-0 flex-col border-r bg-background", narrow && "absolute inset-y-0 left-0 z-10 max-w-[85%] shadow-md")}
          >
            <div role="tablist" aria-label="Sidebar" className="flex shrink-0 border-b text-sm">
              {(pairing ? (["outline", "bookmarks", "highlights", "notes"] as const) : (["outline", "bookmarks", "highlights"] as const)).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={sidebar === tab}
                  onClick={() => setSidebar(tab)}
                  className={cn("flex-1 px-1.5 py-1.5 text-[13px] capitalize", sidebar === tab ? "border-b-2 border-foreground font-medium" : "text-muted-foreground hover:text-foreground")}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {!ready ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>
              ) : sidebar === "outline" ? (
                <>
                  {textState === "noText" && (
                    // OCR is not built (docs/pdf-markup-plan.md, P7 and P8): a scan's words are not in search; its marks and bookmarks are.
                    <p role="note" className="border-b px-3 py-2 text-xs text-muted-foreground">
                      No searchable text (scanned). Search finds this PDF&apos;s highlights, comments, text notes and bookmarks, not its words.
                    </p>
                  )}
                  <OutlineTree items={ready.outline} controls={ready.controls} />
                </>
              ) : sidebar === "highlights" ? (
                <HighlightList marks={edit.marks} labels={ready.labels} controls={ready.controls} selectedId={edit.selectedId} onSelect={(mark) => edit.select(mark.id)} onComment={edit.comment} onDelete={edit.remove} onQuote={pairing ? quote : undefined} quotedIn={pairing ? quotedIn : undefined} />
              ) : sidebar === "notes" && pairing ? (
                <NotesList citations={pairing.citations} pairedNoteId={pairing.noteId} onOpen={pairing.onOpenNote} onNewNote={pairing.onNewNote} />
              ) : (
                <BookmarkList documentId={document.id} documents={documents} controls={ready.controls} labels={ready.labels} refreshKey={bookmarksRead} />
              )}
            </div>
          </aside>
        )}
        <div className="relative min-h-0 min-w-0 flex-1 bg-muted/40">
          {/* pdf.js requires its scroll container to be positioned absolutely */}
          <div
            ref={container}
            tabIndex={0}
            role="document"
            onClick={edit.onContainerClick}
            aria-label={`${document.fileName}, pages`}
            className={cn(
              "absolute inset-0 overflow-auto outline-none",
              // Dark pages inverts the page images only: the text layer and marks drawn over them keep their colors.
              dark && "[&_.canvasWrapper]:[filter:invert(1)_hue-rotate(180deg)]",
            )}
          >
            <div ref={pages} className="pdfViewer" />
          </div>
          {ready && (
            <MarkLayers
              layers={layers}
              dark={dark}
              marks={edit.marks}
              flashId={flashId}
              onQuote={pairing ? quote : undefined}
              selectedId={edit.selectedId}
              placing={edit.placing}
              draft={edit.draft}
              editingId={edit.editingId}
              {...edit.layerHandlers}
            />
          )}
          {edit.anchor && !edit.placing && <SelectionToolbar anchor={edit.anchor} color={edit.color} onColor={edit.chooseColor} onMark={edit.markSelection} />}
          {viewer.phase === "loading" && <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm text-muted-foreground">Opening the PDF…</p>}
          {viewer.phase === "error" && (
            <p role="alert" className="absolute inset-x-0 top-6 px-6 text-center text-sm text-destructive">
              {viewer.message}
            </p>
          )}
          {viewer.phase === "password" && (
            <div className="absolute inset-x-0 top-6 flex flex-col items-center gap-3 px-6 text-center">
              <p className="text-sm text-muted-foreground">This PDF is protected by a password.</p>
              <Button size="sm" onClick={() => setPasswordDismissed(false)}>
                Enter password…
              </Button>
              <PdfPasswordDialog
                open={!passwordDismissed}
                onOpenChange={(open) => setPasswordDismissed(!open)}
                fileName={document.fileName}
                incorrect={viewer.incorrect}
                checking={viewer.checking}
                onSubmit={(password) => {
                  setPasswordDismissed(false);
                  viewer.submit(password);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Toolbar({
  viewer,
  dark,
  onToggleDark,
  sidebar,
  onToggleSidebar,
  findOpen,
  onToggleFind,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  placing,
  onTogglePlacing,
  exporting,
  onExport,
  paired,
  onAddBookmark,
}: {
  viewer: PdfViewer;
  dark: boolean;
  onToggleDark: () => void;
  sidebar: SidebarTab | null;
  onToggleSidebar: () => void;
  findOpen: boolean;
  onToggleFind: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  placing: boolean;
  onTogglePlacing: () => void;
  exporting: boolean;
  onExport: () => void;
  /** What the toolbar offers for the note beside the PDF; null when the PDF has none (nothing to cite into). */
  paired: { follow: boolean; noteTitle: string | null; onToggleFollow: () => void; onCite: () => void } | null;
  onAddBookmark: () => void;
}) {
  const ready = viewer.phase === "ready" ? viewer : null;
  return (
    <div role="toolbar" aria-label="PDF tools" className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b px-2 py-1">
      <Button variant="ghost" size="icon-sm" aria-label="Outline and bookmarks" aria-pressed={sidebar !== null} onClick={onToggleSidebar} title="Outline and bookmarks">
        <PanelLeftIcon />
      </Button>
      <PageBox viewer={ready} />
      <div className="mx-1 hidden h-4 w-px bg-border sm:block" />
      <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={!ready} onClick={() => ready?.controls.zoomOut()} title="Zoom out">
        <ZoomOutIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={!ready} onClick={() => ready?.controls.zoomIn()} title="Zoom in">
        <ZoomInIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Fit to width" disabled={!ready} onClick={() => ready?.controls.fitWidth()} title="Fit to width">
        <MoveHorizontalIcon />
      </Button>
      <div className="ml-auto" />
      <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={onUndo} title="Undo the last change to the marks (Ctrl/Cmd+Z)">
        <Undo2Icon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
        <Redo2Icon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Add a text note" aria-pressed={placing} disabled={!ready} onClick={onTogglePlacing} title="Add a text note: click where it goes on a page">
        <StickyNoteIcon />
      </Button>
      {paired && (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Cite this page" disabled={!ready} onClick={paired.onCite} title="Put a link to this page into the note beside the PDF">
            <Link2Icon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Follow the note in use"
            aria-pressed={paired.follow}
            onClick={paired.onToggleFollow}
            title={
              paired.follow
                ? "Quoting into the note you use last. Click to stay with one note."
                : `Quoting into ${paired.noteTitle ? `“${paired.noteTitle}”` : "its note"}. Click to follow the note you use instead.`
            }
          >
            <NotebookPenIcon />
          </Button>
        </>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Find in this PDF" aria-pressed={findOpen} disabled={!ready} onClick={onToggleFind} title="Find in this PDF (Ctrl/Cmd+F)">
        <SearchIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Export annotated PDF" disabled={!ready || exporting} onClick={onExport} title="Export a copy of this PDF with its marks in it">
        <DownloadIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Bookmark this page" disabled={!ready} onClick={onAddBookmark} title="Bookmark this page">
        <BookmarkPlusIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Dark pages" aria-pressed={dark} onClick={onToggleDark} title="Dark pages: invert the pages' colors">
        <MoonIcon />
      </Button>
    </div>
  );
}

/** The page the reader is on, which can be typed over to go to another; the printed label is shown when it differs from the number. */
function PageBox({ viewer }: { viewer: Extract<PdfViewer, { phase: "ready" }> | null }) {
  // What is typed over the number belongs to the page it was typed on: once the reader is somewhere else, the page shows.
  const [typed, setTyped] = useState<{ page: number; text: string } | null>(null);
  const page = viewer?.page ?? 0;
  const draft = typed !== null && typed.page === page ? typed.text : null;
  const setDraft = (text: string | null) => setTyped(text === null ? null : { page, text });

  function go() {
    // Enter with nothing typed stays where it is (an untouched box is not the page 0, which would go to page 1).
    if (viewer && draft !== null && draft !== "" && Number.isFinite(Number(draft))) viewer.controls.goToPage(Number(draft));
    setDraft(null);
  }

  const label = viewer ? pageName(page, viewer.labels) : "";
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
      <Input
        aria-label="Page number"
        inputMode="numeric"
        disabled={!viewer}
        value={draft ?? (viewer ? String(page) : "")}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
        onFocus={(event) => event.target.select()}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") go();
          if (event.key === "Escape") setDraft(null);
        }}
        className="h-7 w-14 px-1.5 text-center"
      />
      <span>of {viewer?.pageCount ?? "…"}</span>
      {viewer && label !== String(page) && <span title="The page number printed on the page">(page {label})</span>}
    </div>
  );
}

/** The find bar. `initialQuery` is what a search result asked for (the reader has already asked pdf.js to find it); the bar is given a new `key` for each. */
function FindBar({ viewer, initialQuery, onClose }: { viewer: Extract<PdfViewer, { phase: "ready" }>; initialQuery: string; onClose: () => void }) {
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const count = viewer.find;
  return (
    <div role="search" aria-label="Find in this PDF" className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
      <Input
        ref={input}
        aria-label="Find in this PDF"
        placeholder="Find in this PDF"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          viewer.controls.find(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") viewer.controls.find(query, { findPrevious: event.shiftKey });
          if (event.key === "Escape") onClose();
        }}
        className="h-7 max-w-64"
      />
      <span aria-live="polite" className="min-w-16 text-xs text-muted-foreground">
        {query === "" || !count ? "" : count.notFound ? "Not found" : `${count.current} of ${count.total}`}
      </span>
      <Button variant="ghost" size="icon-xs" aria-label="Previous match" onClick={() => viewer.controls.find(query, { findPrevious: true })}>
        <ChevronUpIcon />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Next match" onClick={() => viewer.controls.find(query)}>
        <ChevronDownIcon />
      </Button>
      <div className="flex-1" />
      <Button variant="ghost" size="icon-xs" aria-label="Close find" onClick={onClose}>
        <XIcon />
      </Button>
    </div>
  );
}
