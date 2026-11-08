"use client";

import { ChevronRightIcon, PencilIcon, QuoteIcon, StrikethroughIcon, Trash2Icon, UnderlineIcon, HighlighterIcon, StickyNoteIcon, PenLineIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PdfAnnotation, PdfBookmark, PdfCitation } from "@/lib/composition/documentsApi";
import type { PdfTextNoteBody } from "@/lib/composition/pdfMarkup";
import { paintFor } from "./pdfGeometry";
import type { DocumentsStore } from "@/lib/composition/documentsStore";
import { cn } from "@/lib/utils";
import type { OutlineItem, PdfViewerControls } from "./usePdfViewer";

export type SidebarTab = "outline" | "bookmarks" | "highlights" | "notes";

/** What a page is called to the reader: its printed label when the PDF has one ("xii", "42"), else its number. */
export function pageName(page: number, labels: string[] | null): string {
  return labels?.[page - 1] ?? String(page);
}

/** The outline of the PDF, as a tree whose branches fold. */
export function OutlineTree({ items, controls }: { items: OutlineItem[]; controls: PdfViewerControls }) {
  if (items.length === 0) return <p className="px-3 py-2 text-sm text-muted-foreground">This PDF has no outline.</p>;
  return (
    <ul role="tree" aria-label="Outline" className="py-1 text-sm">
      {items.map((item, index) => (
        <OutlineNode key={`${index}-${item.title}`} item={item} depth={0} controls={controls} />
      ))}
    </ul>
  );
}

function OutlineNode({ item, depth, controls }: { item: OutlineItem; depth: number; controls: PdfViewerControls }) {
  // The first levels start open: a textbook's chapters show their sections, deeper ones wait to be asked for.
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = item.items.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={false}>
      <div className="flex items-start gap-0.5 pr-2" style={{ paddingLeft: depth * 12 + 4 }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Fold ${item.title}` : `Unfold ${item.title}`}
            onClick={() => setOpen(!open)}
            className="mt-1 shrink-0 rounded text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => controls.goToDestination(item.dest)}
          className="min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-accent hover:text-accent-foreground"
        >
          <span className="line-clamp-2">{item.title || "Untitled"}</span>
        </button>
      </div>
      {hasChildren && open && (
        <ul role="group">
          {item.items.map((child, index) => (
            <OutlineNode key={`${index}-${child.title}`} item={child} depth={depth + 1} controls={controls} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The bookmarks of the PDF: where you put them, renamed or removed. Adding one is the toolbar's button. */
export function BookmarkList({
  documentId,
  documents,
  controls,
  labels,
  refreshKey,
}: {
  documentId: number;
  documents: DocumentsStore;
  controls: PdfViewerControls;
  labels: string[] | null;
  /** Changes when the toolbar added one, so the list reads again. */
  refreshKey: number;
}) {
  const [bookmarks, setBookmarks] = useState<PdfBookmark[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    documents
      .listBookmarks(documentId)
      .then((found) => current && setBookmarks(found))
      .catch(() => current && setError("The bookmarks could not be read."));
    return () => {
      current = false;
    };
  }, [documents, documentId, refreshKey]);

  if (error) return <p className="px-3 py-2 text-sm text-destructive">{error}</p>;
  if (bookmarks === null) return <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>;
  if (bookmarks.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">No bookmarks yet. Use the bookmark button to mark the page you are on.</p>;
  }

  async function rename(bookmark: PdfBookmark) {
    setEditing(null);
    const saved = await documents.renameBookmark(bookmark.id, draft).catch(() => null);
    if (saved) setBookmarks((all) => all?.map((b) => (b.id === saved.id ? saved : b)) ?? null);
  }

  async function remove(bookmark: PdfBookmark) {
    setBookmarks((all) => all?.filter((b) => b.id !== bookmark.id) ?? null);
    await documents.removeBookmark(bookmark.id).catch(() => setError("A bookmark could not be removed."));
  }

  return (
    <ul aria-label="Bookmarks" className="py-1 text-sm">
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id} className="group flex items-center gap-1 px-2">
          {editing === bookmark.id ? (
            <Input
              autoFocus
              aria-label="Bookmark name"
              value={draft}
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void rename(bookmark)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void rename(bookmark);
                if (event.key === "Escape") setEditing(null);
              }}
              className="h-7"
            />
          ) : (
            <button
              type="button"
              onClick={() => controls.goToPage(bookmark.page + 1)}
              className="min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-accent hover:text-accent-foreground"
            >
              <span className="block truncate">{bookmark.label || `Page ${pageName(bookmark.page + 1, labels)}`}</span>
              {bookmark.label && <span className="block text-xs text-muted-foreground">Page {pageName(bookmark.page + 1, labels)}</span>}
            </button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Rename the bookmark on page ${pageName(bookmark.page + 1, labels)}`}
            onClick={() => {
              setDraft(bookmark.label);
              setEditing(bookmark.id);
            }}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove the bookmark on page ${pageName(bookmark.page + 1, labels)}`}
            onClick={() => void remove(bookmark)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Trash2Icon />
          </Button>
        </li>
      ))}
    </ul>
  );
}

const KIND_ICON = { highlight: HighlighterIcon, underline: UnderlineIcon, strikethrough: StrikethroughIcon, text: StickyNoteIcon, ink: PenLineIcon } as const;

/** What a mark is called in the list: the words it marks, a text note's words, or what ink is. */
function markText(mark: PdfAnnotation): string {
  if (mark.kind === "text") return (mark.body as Partial<PdfTextNoteBody> | null)?.text?.trim() || "(empty note)";
  if (mark.kind === "ink") return "Ink";
  return mark.quote || "(no text)";
}

/** Every mark of the PDF by page, to jump to, to comment on, and to delete. */
export function HighlightList({
  marks,
  labels,
  controls,
  selectedId,
  onSelect,
  onComment,
  onDelete,
  onQuote,
  quotedIn,
}: {
  marks: PdfAnnotation[];
  labels: string[] | null;
  controls: PdfViewerControls;
  selectedId: number | null;
  onSelect: (mark: PdfAnnotation) => void;
  onComment: (mark: PdfAnnotation, comment: string) => void;
  onDelete: (mark: PdfAnnotation) => void;
  /** Quotes a mark into the paired note. */
  onQuote?: (mark: PdfAnnotation) => void;
  /** The titles of the notes that already cite a mark, to show it has been quoted. */
  quotedIn?: (markUuid: string) => string[];
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  if (marks.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">No highlights yet. Select text on a page and choose a highlight, an underline or a strikethrough.</p>;
  }

  // What is typed narrows the list to the marks whose words, comment or text note say it (case aside).
  const wanted = filter.trim().toLowerCase();
  const shown = wanted === "" ? marks : marks.filter((m) => `${markText(m)}\n${m.comment}`.toLowerCase().includes(wanted));
  const pages = [...new Set(shown.map((m) => m.page))];
  function jump(mark: PdfAnnotation) {
    onSelect(mark);
    const rect = mark.rects?.[0] ?? (mark.body as Partial<PdfTextNoteBody> | null)?.rect;
    if (rect) controls.goToRect(mark.page + 1, rect);
    else controls.goToPage(mark.page + 1);
  }

  return (
    <div className="py-1 text-sm">
      <Input aria-label="Filter highlights" placeholder="Filter highlights" value={filter} onChange={(event) => setFilter(event.target.value)} className="mx-2 mb-1 h-7 w-[calc(100%-1rem)]" />
      {shown.length === 0 && <p className="px-3 py-2 text-muted-foreground">No highlight says that.</p>}
      <div aria-label="Highlights" role="list">
        {pages.map((page) => (
          <div key={page} role="listitem">
            <div className="px-3 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">Page {pageName(page + 1, labels)}</div>
            <ul>
              {shown
                .filter((m) => m.page === page)
                .map((mark) => {
                  const Icon = KIND_ICON[mark.kind];
                  const quoted = quotedIn?.(mark.uuid) ?? [];
                  return (
                    <li key={mark.id} data-mark-id={mark.id} className={cn("group flex items-start gap-1.5 px-2 py-0.5", mark.id === selectedId && "bg-accent/60")}>
                      <span style={{ background: paintFor(mark.color).fill }} className="mt-1 flex size-5 shrink-0 items-center justify-center rounded">
                        <Icon className="size-3.5" aria-label={mark.kind} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => jump(mark)} className="block w-full rounded px-1 text-left hover:bg-accent hover:text-accent-foreground">
                          <span className="line-clamp-3">{markText(mark)}</span>
                        </button>
                        {editing === mark.id ? (
                          <Input
                            autoFocus
                            aria-label="Comment"
                            value={draft}
                            maxLength={500}
                            onChange={(event) => setDraft(event.target.value)}
                            onBlur={() => {
                              setEditing(null);
                              if (draft !== mark.comment) onComment(mark, draft);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                              if (event.key === "Escape") {
                                setDraft(mark.comment);
                                setEditing(null);
                              }
                            }}
                            className="mt-0.5 h-7"
                          />
                        ) : (
                          mark.kind !== "ink" &&
                          mark.kind !== "text" && (
                            <button
                              type="button"
                              onClick={() => {
                                setDraft(mark.comment);
                                setEditing(mark.id);
                              }}
                              className="block w-full truncate rounded px-1 text-left text-xs text-muted-foreground hover:text-foreground"
                            >
                              {mark.comment || "Add a comment"}
                            </button>
                          )
                        )}
                      </div>
                      {quoted.length > 0 && (
                        <span title={`Quoted in ${quoted.join(", ")}`} aria-label={`Quoted in ${quoted.join(", ")}`} className="mt-1 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                          <QuoteIcon className="size-3.5" />
                        </span>
                      )}
                      {onQuote && mark.quote !== "" && (
                        <Button variant="ghost" size="icon-xs" aria-label={`Quote the ${mark.kind} on page ${pageName(page + 1, labels)}`} title="Quote these words into the note beside the PDF" onClick={() => onQuote(mark)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                          <QuoteIcon />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-xs" aria-label={`Delete the ${mark.kind} on page ${pageName(page + 1, labels)}`} onClick={() => onDelete(mark)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                        <Trash2Icon />
                      </Button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The notes that belong with the PDF: its own note first, then every note whose text links to it, with how many of its pages
 * each cites. Picking one shows it in the note panel beside the PDF; the note the PDF is paired with is marked.
 */
export function NotesList({
  citations,
  pairedNoteId,
  onOpen,
  onNewNote,
}: {
  citations: PdfCitation[];
  pairedNoteId: number | null;
  onOpen: (noteId: number) => void;
  onNewNote: () => void;
}) {
  return (
    <div className="py-1 text-sm">
      <ul aria-label="Notes">
        {citations.map((citation) => {
          const cited = citation.pages.length;
          return (
            <li key={citation.noteId}>
              <button
                type="button"
                aria-current={citation.noteId === pairedNoteId ? "true" : undefined}
                onClick={() => onOpen(citation.noteId)}
                className={cn("block w-full px-3 py-1 text-left hover:bg-accent hover:text-accent-foreground", citation.noteId === pairedNoteId && "bg-accent/60")}
              >
                <span className="block truncate">{citation.title.trim() || "Untitled"}</span>
                <span className="block text-xs text-muted-foreground">
                  {citation.owner ? "This PDF's own note" : "Cites this PDF"}
                  {cited > 0 && ` · ${cited === 1 ? "1 page" : `${cited} pages`}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" onClick={onNewNote} className="mx-2 mt-1 w-[calc(100%-1rem)] justify-start">
        <PlusIcon />
        New note for this PDF
      </Button>
    </div>
  );
}
