"use client";

import { CheckIcon, ChevronLeftIcon, CopyIcon, ExternalLinkIcon, InboxIcon, MoreHorizontalIcon, PlusIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon, UndoIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { feedHostLabel, feedLabel, feedsNeedRefresh } from "@/lib/composition/feeds";
import { MAX_FEED_URL_LENGTH, type Feed, type FeedEntry } from "@/lib/composition/feedsApi";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../ConfirmDialog";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { usePlugins } from "../plugins/usePlugins";
import type { RssPanelState } from "./kinds";
import type { PanelId } from "./layoutTree";

/** From this container width the feeds and the entries sit side by side; below it the panel shows one at a time. */
export const RSS_SIDE_BY_SIDE_MIN_WIDTH = 640;

/** The most entries listed at once; a busy "all entries" is the newest of them. */
const MAX_LISTED_ENTRIES = 300;

const openInBrowser = (url: string) => void window.open(url, "_blank", "noopener");

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

/** The box at the top of the feed list: paste a feed address, press Enter. The feed is read before it is kept, which can take a few seconds. */
function SubscribeBox({ store, onAdded }: { store: WorkspaceStore; onAdded: (feed: Feed) => void }) {
  const feedsStore = store.feeds;
  const { subscribing } = useSyncExternalStore(feedsStore.subscribe, feedsStore.getSnapshot, feedsStore.getSnapshot);
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    if (value.trim() === "" || subscribing) return;
    const { feed, error, existingId } = await feedsStore.addFeed(value);
    if (error !== undefined) {
      // The text stays so it can be fixed; a feed that is already there is shown instead.
      setProblem(error);
      const existing = existingId === undefined ? undefined : feedsStore.getSnapshot().feeds.find((f) => f.id === existingId);
      if (existing) onAdded(existing);
      return;
    }
    setProblem(null);
    setValue("");
    if (feed) onAdded(feed);
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label="Add a feed"
        placeholder={subscribing ? "Fetching the feed…" : "Paste a feed address and press Enter"}
        value={value}
        disabled={subscribing}
        maxLength={MAX_FEED_URL_LENGTH}
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

function Unread({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span aria-hidden className="shrink-0 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
      {count}
    </span>
  );
}

function FeedRow({
  feed,
  selected,
  fetching,
  onPick,
  onRefresh,
  onMarkRead,
  onUnsubscribe,
}: {
  feed: Feed;
  selected: boolean;
  fetching: boolean;
  onPick: () => void;
  onRefresh: () => void;
  onMarkRead: () => void;
  onUnsubscribe: () => void;
}) {
  const label = feedLabel(feed);
  return (
    <li className={cn("group flex items-center gap-1 rounded-md pr-1 hover:bg-muted/50 focus-within:bg-muted/50", selected && "bg-muted")}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={`${label}${feed.unread > 0 ? `, ${feed.unread} unread` : ""}${feed.lastError ? ", could not be fetched" : ""}`}
        title={feed.lastError || feed.url}
        onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {feed.lastError ? <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0 text-destructive" /> : <span aria-hidden className={cn("size-2 shrink-0 rounded-full", feed.unread > 0 ? "bg-brand" : "bg-transparent")} />}
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {fetching ? <RefreshCwIcon aria-hidden className="size-3 shrink-0 animate-spin text-muted-foreground" /> : <Unread count={feed.unread} />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Options for ${label}`} className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRefresh}>
            <RefreshCwIcon /> Refresh
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onMarkRead} disabled={feed.unread === 0}>
            <CheckIcon /> Mark all read
          </DropdownMenuItem>
          {feed.siteUrl && (
            <DropdownMenuItem onSelect={() => openInBrowser(feed.siteUrl)}>
              <ExternalLinkIcon /> Open site in browser
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(feed.url)}>
            <CopyIcon /> Copy feed address
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onUnsubscribe}>
            <Trash2Icon /> Unsubscribe
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function EntryRow({ entry, feedName, selected, onPick }: { entry: FeedEntry; feedName: string | null; selected: boolean; onPick: () => void }) {
  const title = entry.title === "" ? "(untitled)" : entry.title;
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        aria-label={`${title}${entry.read ? " (read)" : ""}`}
        onClick={onPick}
        className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring", selected && "bg-muted", entry.read && "opacity-60")}
      >
        <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", entry.read ? "bg-transparent" : "bg-brand")} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-sm", !entry.read && "font-medium")}>{title}</span>
          <span className="truncate text-xs text-muted-foreground">{[feedName, formatDate(entry.publishedAt)].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
    </li>
  );
}

/** The entry that is open: its excerpt and what can be done with it. The feed's own markup is never shown, only its text. */
function EntryDetail({
  entry,
  feed,
  store,
  canSendToReadingList,
  onBack,
}: {
  entry: FeedEntry;
  feed: Feed | undefined;
  store: WorkspaceStore;
  canSendToReadingList: boolean;
  onBack: (() => void) | null;
}) {
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  // The panel gives each entry its own copy of this (a key), so what was said about one does not carry to the next.

  const open = () => {
    openInBrowser(entry.url);
    // Opening it is the sign it has been dealt with.
    if (!entry.read) void store.feeds.setEntryRead(entry.id, true);
  };

  async function send() {
    const { error } = await store.readingList.add(entry.url);
    setNote(error === undefined ? { text: "Added to your Reading List.", problem: false } : { text: error, problem: true });
  }

  return (
    <section aria-label="Entry" className="flex min-h-0 flex-col gap-2 overflow-y-auto border-t p-3">
      {onBack && (
        <Button variant="ghost" size="xs" className="self-start" onClick={onBack}>
          <ChevronLeftIcon /> Back to entries
        </Button>
      )}
      <h3 className="text-sm font-semibold">{entry.title === "" ? "(untitled)" : entry.title}</h3>
      <p className="text-xs text-muted-foreground">{[feed ? feedLabel(feed) : null, formatDate(entry.publishedAt)].filter(Boolean).join(" · ")}</p>
      <p className="whitespace-pre-line text-sm">{entry.summary === "" ? <span className="text-muted-foreground">This feed sent no excerpt. Open the entry to read it.</span> : entry.summary}</p>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="xs" variant="outline" disabled={entry.url === ""} onClick={open}>
          <ExternalLinkIcon /> Open in browser
        </Button>
        {canSendToReadingList && (
          <Button size="xs" variant="outline" disabled={entry.url === ""} onClick={() => void send()}>
            <PlusIcon /> Send to Reading List
          </Button>
        )}
        <Button size="xs" variant={entry.read ? "secondary" : "ghost"} aria-pressed={entry.read} onClick={() => void store.feeds.setEntryRead(entry.id, !entry.read)}>
          {entry.read ? <UndoIcon /> : <CheckIcon />} {entry.read ? "Mark unread" : "Mark read"}
        </Button>
      </div>
      {note && (
        <p role={note.problem ? "alert" : "status"} className={cn("text-xs", note.problem ? "text-destructive" : "text-muted-foreground")}>
          {note.text}
        </p>
      )}
    </section>
  );
}

/**
 * The RSS Reader: the feeds you are subscribed to on the left and, on the right, the entries of the one picked (or of all of
 * them), with the open entry's excerpt beneath. The feeds and entries are the workspace's, so every RSS panel, in any window,
 * shows the same ones; the panel saves only which feed and entry it has open. Opening the panel fetches feeds that have not
 * been fetched lately; the app also refreshes them from time to time while it is open.
 */
export function RssPanel({ store, panelId, state }: { store: WorkspaceStore; panelId: PanelId; state: RssPanelState }) {
  const feedsStore = store.feeds;
  const { status, feeds, entries, refreshing, error } = useSyncExternalStore(feedsStore.subscribe, feedsStore.getSnapshot, feedsStore.getSnapshot);
  const { enabled } = usePlugins(store.plugins);
  const [unsubscribing, setUnsubscribing] = useState<Feed | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // A narrow panel shows the feeds, the entries, or one entry.
  const [narrowView, setNarrowView] = useState<"feeds" | "entries" | "entry">("feeds");

  useEffect(() => {
    let cancelled = false;
    void feedsStore.load().then(() => {
      if (!cancelled && feedsNeedRefresh(feedsStore.getSnapshot().feeds, Date.now())) void feedsStore.refreshAll();
    });
    // The app may have fetched in the background while the window was out of focus.
    const onFocus = () => void feedsStore.reload();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [feedsStore]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const feedById = useMemo(() => new Map(feeds.map((f) => [f.id, f])), [feeds]);
  // A saved feed that has since been unsubscribed falls back to showing everything.
  const selectedFeed = state.selectedFeedId === null ? null : (feedById.get(state.selectedFeedId) ?? null);
  const shown = useMemo(() => (selectedFeed ? entries.filter((e) => e.feedId === selectedFeed.id) : entries), [entries, selectedFeed]);
  const selectedEntry = state.selectedEntryId === null ? null : (shown.find((e) => e.id === state.selectedEntryId) ?? null);
  const sideBySide = width >= RSS_SIDE_BY_SIDE_MIN_WIDTH;
  const totalUnread = feeds.reduce((sum, f) => sum + f.unread, 0);
  const fetchingAny = refreshing.length > 0;

  const save = (next: Partial<RssPanelState>) => store.setPanelState(panelId, { ...state, ...next } satisfies RssPanelState);
  const pickFeed = (feedId: number | null) => {
    setNarrowView("entries");
    if (feedId !== state.selectedFeedId) save({ selectedFeedId: feedId, selectedEntryId: null });
  };
  const pickEntry = (entryId: number) => {
    setNarrowView("entry");
    if (entryId !== state.selectedEntryId) save({ selectedEntryId: entryId });
  };

  const feedList = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
      <SubscribeBox store={store} onAdded={(feed) => pickFeed(feed.id)} />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === "error" ? (
          <div className="flex flex-col items-start gap-2 p-1 text-sm text-muted-foreground">
            <span>Your feeds could not be loaded.</span>
            <Button size="sm" variant="outline" onClick={() => void feedsStore.load()}>
              Try again
            </Button>
          </div>
        ) : status !== "ready" ? (
          <p className="p-1 text-sm text-muted-foreground">Loading…</p>
        ) : feeds.length === 0 ? (
          <p className="p-1 text-sm text-muted-foreground">No feeds yet. Paste the address of one above.</p>
        ) : (
          <>
            <button
              type="button"
              aria-current={selectedFeed === null ? "true" : undefined}
              onClick={() => pickFeed(null)}
              className={cn("mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring", selectedFeed === null && "bg-muted")}
            >
              <InboxIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">All entries</span>
              <Unread count={totalUnread} />
            </button>
            <ul aria-label="Feeds">
              {feeds.map((feed) => (
                <FeedRow
                  key={feed.id}
                  feed={feed}
                  selected={selectedFeed?.id === feed.id}
                  fetching={refreshing.includes(feed.id)}
                  onPick={() => pickFeed(feed.id)}
                  onRefresh={() => void feedsStore.refresh(feed.id)}
                  onMarkRead={() => void feedsStore.markRead(feed.id)}
                  onUnsubscribe={() => setUnsubscribing(feed)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );

  const entryPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1">
        {!sideBySide && (
          <Button variant="ghost" size="xs" onClick={() => setNarrowView("feeds")}>
            <ChevronLeftIcon /> Back to feeds
          </Button>
        )}
        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{selectedFeed ? feedLabel(selectedFeed) : "All entries"}</h2>
        <Button variant="ghost" size="xs" disabled={fetchingAny || feeds.length === 0} onClick={() => void (selectedFeed ? feedsStore.refresh(selectedFeed.id) : feedsStore.refreshAll())}>
          <RefreshCwIcon className={cn(fetchingAny && "animate-spin")} /> Refresh
        </Button>
        <Button variant="ghost" size="xs" disabled={(selectedFeed ? selectedFeed.unread : totalUnread) === 0} onClick={() => void feedsStore.markRead(selectedFeed ? selectedFeed.id : null)}>
          <CheckIcon /> Mark all read
        </Button>
      </div>
      {selectedFeed?.lastError && (
        <p role="alert" className="flex items-start gap-1.5 border-b px-3 py-1.5 text-xs text-destructive">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This feed could not be fetched: {selectedFeed.lastError} The entries below are from the last time it worked ({feedHostLabel(selectedFeed.url)}).
          </span>
        </p>
      )}
      {narrowView === "entry" && !sideBySide && selectedEntry ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {status !== "ready" ? null : shown.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{feeds.length === 0 ? "Subscribe to a feed to see its entries here." : "Nothing here yet."}</p>
          ) : (
            <>
              <ul aria-label="Entries">
                {shown.slice(0, MAX_LISTED_ENTRIES).map((entry) => (
                  <EntryRow key={entry.id} entry={entry} feedName={selectedFeed ? null : (feedById.get(entry.feedId) ? feedLabel(feedById.get(entry.feedId)!) : null)} selected={entry.id === selectedEntry?.id} onPick={() => pickEntry(entry.id)} />
                ))}
              </ul>
              {shown.length > MAX_LISTED_ENTRIES && <p className="p-2 text-xs text-muted-foreground">Showing the newest {MAX_LISTED_ENTRIES} of {shown.length}.</p>}
            </>
          )}
        </div>
      )}
      {selectedEntry && (sideBySide || narrowView === "entry") && (
        <div className={cn("flex min-h-0 flex-col", sideBySide ? "max-h-[45%] shrink-0" : "flex-1")}>
          <EntryDetail
            key={selectedEntry.id}
            entry={selectedEntry}
            feed={feedById.get(selectedEntry.feedId)}
            store={store}
            canSendToReadingList={enabled["reading-list"]}
            onBack={sideBySide ? null : () => setNarrowView("entries")}
          />
        </div>
      )}
    </div>
  );

  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1">
      {sideBySide ? (
        <>
          <div className="flex min-h-0 w-60 shrink-0 flex-col border-r">{feedList}</div>
          {entryPane}
        </>
      ) : narrowView === "feeds" ? (
        feedList
      ) : (
        entryPane
      )}
      <ConfirmDialog
        open={unsubscribing !== null}
        title="Unsubscribe from this feed?"
        description={
          unsubscribing && (
            <>
              <strong>{feedLabel(unsubscribing)}</strong> and its entries will be removed for good. They are not sent to the Trash Can; to get the feed back, subscribe again.
            </>
          )
        }
        confirmLabel="Unsubscribe"
        onCancel={() => setUnsubscribing(null)}
        onConfirm={() => {
          if (unsubscribing) {
            void feedsStore.removeFeed(unsubscribing.id);
            // A panel showing the feed that is gone falls back to all entries.
            if (state.selectedFeedId === unsubscribing.id) save({ selectedFeedId: null, selectedEntryId: null });
          }
          setUnsubscribing(null);
        }}
      />
    </div>
  );
}
