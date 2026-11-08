"use client";

import { ChevronRightIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PdfBookmark } from "@/lib/composition/documentsApi";
import type { DocumentsStore } from "@/lib/composition/documentsStore";
import { cn } from "@/lib/utils";
import type { OutlineItem, PdfViewerControls } from "./usePdfViewer";

export type SidebarTab = "outline" | "bookmarks";

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
