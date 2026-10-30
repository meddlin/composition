"use client";

import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronLeftIcon, CopyIcon, ExternalLinkIcon, MoreHorizontalIcon, RotateCwIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { hostLabel, readingItemLabel, sortReadingItems } from "@/lib/composition/readingList";
import { MAX_READING_URL_LENGTH, type ReadingItem } from "@/lib/composition/readingListApi";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ConfirmDialog";
import { ResizeHandle } from "../notes/ResizeHandle";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { READING_LIST_MIN_WIDTH, READING_PAGE_MIN_WIDTH, type ReadingListPanelState } from "./kinds";
import type { PanelId } from "./layoutTree";
import { ReadingWebview } from "./ReadingWebview";
import type { WebviewComponent, WebviewHandle, WebviewState } from "./webviewSeam";

/** From this container width the list and the page sit side by side; below it the panel shows one at a time. */
export const SIDE_BY_SIDE_MIN_WIDTH = 640;

const openInBrowser = (url: string) => void window.open(url, "_blank", "noopener");

/** The box at the top of the list: paste a link, press Enter. It stays open for the next one. */
function AddBox({ store, onAdded }: { store: WorkspaceStore; onAdded: (item: ReadingItem) => void }) {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    if (value.trim() === "") return;
    const { item, error, existingId } = await store.readingList.add(value);
    if (error !== undefined) {
      // The text stays so it can be fixed; a link that is already there is shown instead.
      setProblem(error);
      const existing = existingId === undefined ? undefined : store.readingList.getSnapshot().items.find((i) => i.id === existingId);
      if (existing) onAdded(existing);
      return;
    }
    setProblem(null);
    setValue("");
    if (item) onAdded(item);
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label="Add a link"
        placeholder="Paste a link and press Enter"
        value={value}
        maxLength={MAX_READING_URL_LENGTH}
        spellCheck={false}
        className="h-7"
        onChange={(event) => {
          setValue(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

function ReadingRow({
  item,
  selected,
  onPick,
  onToggleRead,
  onDelete,
}: {
  item: ReadingItem;
  selected: boolean;
  onPick: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const label = readingItemLabel(item);
  return (
    <li className={cn("group flex items-center gap-1 rounded-md pr-1 hover:bg-muted/50 focus-within:bg-muted/50", selected && "bg-muted")}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={`${label}${item.read ? " (read)" : ""}`}
        title={item.url}
        onClick={onPick}
        className={cn("flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", item.read && "opacity-60")}
      >
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-brand")} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{label}</span>
          <span className="truncate text-xs text-muted-foreground">{hostLabel(item.url)}</span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Options for ${label}`} className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openInBrowser(item.url)}>
            <ExternalLinkIcon /> Open in browser
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(item.url)}>
            <CopyIcon /> Copy link
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleRead}>
            {item.read ? <UndoIcon /> : <CheckIcon />} {item.read ? "Mark unread" : "Mark read"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** The bar over the page: the view's own history, the address, and what can be done with the link. */
function PageToolbar({
  item,
  state,
  handle,
  onToggleRead,
  onBackToList,
}: {
  item: ReadingItem;
  state: WebviewState;
  handle: React.RefObject<WebviewHandle | null>;
  onToggleRead: () => void;
  onBackToList: (() => void) | null;
}) {
  return (
    <div role="toolbar" aria-label="Page" className="flex items-center gap-1 border-b px-2 py-1">
      {onBackToList && (
        <Button variant="ghost" size="xs" onClick={onBackToList}>
          <ChevronLeftIcon /> Back to list
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" aria-label="Back" disabled={!state.canGoBack} onClick={() => handle.current?.back()}>
        <ArrowLeftIcon />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Forward" disabled={!state.canGoForward} onClick={() => handle.current?.forward()}>
        <ArrowRightIcon />
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label="Reload" onClick={() => handle.current?.reload()}>
        <RotateCwIcon className={cn(state.loading && "animate-spin")} />
      </Button>
      <span aria-label="Address" title={state.url} className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
        {state.url}
      </span>
      <Button variant="ghost" size="xs" onClick={() => openInBrowser(state.url)}>
        <ExternalLinkIcon /> Open in browser
      </Button>
      <Button variant={item.read ? "secondary" : "ghost"} size="xs" aria-pressed={item.read} onClick={onToggleRead}>
        {item.read ? <UndoIcon /> : <CheckIcon />} {item.read ? "Mark unread" : "Mark read"}
      </Button>
    </div>
  );
}

/** The page of the link that is open, with its toolbar. A new one is made for each link, so each starts with a history of its own. */
function ReadingPage({
  item,
  store,
  Webview,
  onBackToList,
}: {
  item: ReadingItem;
  store: WorkspaceStore;
  Webview: WebviewComponent;
  onBackToList: (() => void) | null;
}) {
  const handle = useRef<WebviewHandle>(null);
  const [state, setState] = useState<WebviewState>({ url: item.url, title: null, canGoBack: false, canGoForward: false, loading: true, failure: null });
  const itemId = item.id;

  function change(next: Partial<WebviewState>) {
    setState((current) => ({ ...current, ...next }));
    // The page names the link the first time it loads; a link that has a name keeps it.
    if (next.title) void store.readingList.setTitle(itemId, next.title);
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PageToolbar item={item} state={state} handle={handle} onBackToList={onBackToList} onToggleRead={() => void store.readingList.setRead(item.id, !item.read)} />
      <div className="relative flex min-h-0 flex-1">
        <Webview src={item.url} onChange={change} handle={handle} />
        {state.failure && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background p-4 text-center text-sm">
            <p className="font-medium">This page could not be loaded.</p>
            <p className="text-muted-foreground">{state.failure}</p>
            <Button size="sm" variant="outline" onClick={() => openInBrowser(state.url)}>
              <ExternalLinkIcon /> Open in browser
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The Reading List: links on the left and, on the right, the page of the one picked, so a reading list can be read without
 * leaving the app. The links are the workspace's, so every Reading List panel, in any window, shows the same list; the panel
 * saves only which link it has open and how wide its list is. `Webview` is a seam for tests (jsdom has no `<webview>`).
 */
export function ReadingListPanel({
  store,
  panelId,
  state,
  Webview = ReadingWebview,
}: {
  store: WorkspaceStore;
  panelId: PanelId;
  state: ReadingListPanelState;
  Webview?: WebviewComponent;
}) {
  const listStore = store.readingList;
  const { status, items, error } = useSyncExternalStore(listStore.subscribe, listStore.getSnapshot, listStore.getSnapshot);
  const [deleting, setDeleting] = useState<ReadingItem | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // While a divider is dragged its width is kept here, and saved with the layout once it is let go.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStart = useRef(0);
  // A narrow panel shows the list or the page, not both.
  const [narrowList, setNarrowList] = useState(state.selectedId === null);

  useEffect(() => {
    void listStore.load();
  }, [listStore]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sorted = useMemo(() => sortReadingItems(items), [items]);
  const selected = items.find((i) => i.id === state.selectedId) ?? null;
  const sideBySide = width >= SIDE_BY_SIDE_MIN_WIDTH;

  const pick = (id: number) => {
    setNarrowList(false);
    if (id !== state.selectedId) store.setPanelState(panelId, { ...state, selectedId: id } satisfies ReadingListPanelState);
  };

  const maxListWidth = Math.max(READING_LIST_MIN_WIDTH, width - READING_PAGE_MIN_WIDTH);
  const listWidth = Math.min(maxListWidth, Math.max(READING_LIST_MIN_WIDTH, dragWidth ?? state.listWidth));

  const list = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
      <AddBox store={store} onAdded={(item) => pick(item.id)} />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === "error" ? (
          <div className="flex flex-col items-start gap-2 p-1 text-sm text-muted-foreground">
            <span>The Reading List could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => void listStore.load()}>
              Try again
            </Button>
          </div>
        ) : status !== "ready" ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="p-1 text-sm text-muted-foreground">No links yet. Paste one above.</p>
        ) : (
          <ul aria-label="Reading List">
            {sorted.map((item) => (
              <ReadingRow
                key={item.id}
                item={item}
                selected={item.id === state.selectedId}
                onPick={() => pick(item.id)}
                onToggleRead={() => void listStore.setRead(item.id, !item.read)}
                onDelete={() => setDeleting(item)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const page = selected ? (
    <ReadingPage key={selected.id} item={selected} store={store} Webview={Webview} onBackToList={sideBySide ? null : () => setNarrowList(true)} />
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">Pick an article</div>
  );

  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1">
      {sideBySide ? (
        <>
          <div className="flex min-h-0 shrink-0 flex-col" style={{ width: listWidth }}>
            {list}
          </div>
          <ResizeHandle
            label="Resize the list"
            valueNow={Math.round(listWidth)}
            valueMin={READING_LIST_MIN_WIDTH}
            valueMax={Math.round(maxListWidth)}
            onResizeStart={() => {
              dragStart.current = listWidth;
            }}
            onResize={(delta) => setDragWidth(Math.min(maxListWidth, Math.max(READING_LIST_MIN_WIDTH, dragStart.current + delta)))}
            onResizeEnd={() => {
              if (dragWidth !== null) store.setPanelState(panelId, { ...state, listWidth: Math.round(dragWidth) } satisfies ReadingListPanelState);
              setDragWidth(null);
            }}
          />
          {page}
        </>
      ) : narrowList || !selected ? (
        list
      ) : (
        page
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this link?"
        description={
          deleting && (
            <>
              <strong>{readingItemLabel(deleting)}</strong> will be removed from your Reading List for good. It is not sent to the Trash Can; to get it back, paste the link again.
            </>
          )
        }
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void listStore.remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
