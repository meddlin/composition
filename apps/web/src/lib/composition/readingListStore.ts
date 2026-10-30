import { cleanReadingTitle, normalizeReadingUrl, readingItemLabel } from "./readingList";
import type { ReadingItem, ReadingListApi } from "./readingListApi";

/** What the store reaches outside for: the Reading List's backend. */
export type ReadingListDeps = ReadingListApi;

export type ReadingListSnapshot = {
  /** `idle` until the first `load`; `error` if that failed (the links are then unknown, not empty). */
  status: "idle" | "loading" | "ready" | "error";
  items: ReadingItem[];
  /** Why the last load or change failed, until the next one succeeds. */
  error: string | null;
};

/** What a change that can be refused reports: the reason, or nothing when it went through. A link already in the list also says which. */
export type ReadingResult = { error?: string; existingId?: number };

export type ReadingListStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReadingListSnapshot;
  /** Reads the links from the backend. Does nothing once they are loaded (or while they load); after a failure it tries again. */
  load(): Promise<void>;
  /** Adds a link at the end; `item` is the new link. A bad address, or one already in the list (then `existingId` is that link), is refused. */
  add(url: string): Promise<ReadingResult & { item?: ReadingItem }>;
  /** Fills in a link's title if it has none. Nothing is shown or sent for a link that already has one. */
  setTitle(id: number, title: string): Promise<ReadingResult>;
  /** Shows the change at once. */
  setRead(id: number, read: boolean): Promise<ReadingResult>;
  /** Removes the link at once, for good. */
  remove(id: number): Promise<ReadingResult>;
};

export const NO_READING_LIST: ReadingListSnapshot = { status: "idle", items: [], error: null };

const reason = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");

/**
 * The Reading List's links, with no React in it, so every panel showing them (in any window) sees the same list. A change
 * shows at once and is sent to the backend; if the backend refuses it, the list is read again so the screen shows what is
 * really stored.
 */
export function createReadingListStore(deps: ReadingListDeps): ReadingListStore {
  let state: ReadingListSnapshot = NO_READING_LIST;
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;

  function set(next: Partial<ReadingListSnapshot>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }

  function load(): Promise<void> {
    if (state.status === "ready") return Promise.resolve();
    if (loading) return loading;
    set({ status: "loading", error: null });
    loading = deps
      .listReadingItems()
      .then((items) => set({ status: "ready", items, error: null }))
      .catch((error) => set({ status: "error", error: reason(error) }))
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  /** A change the backend turned down (or failed): shows why, and puts back what is really stored. */
  async function undo(error: unknown): Promise<ReadingResult> {
    const message = reason(error);
    try {
      set({ items: await deps.listReadingItems(), error: message });
    } catch {
      set({ error: message });
    }
    return { error: message };
  }

  const replace = (item: ReadingItem) => set({ items: state.items.map((i) => (i.id === item.id ? item : i)) });

  async function add(input: string) {
    const { url, error } = normalizeReadingUrl(input);
    if (error !== undefined) return { error };
    const existing = state.items.find((i) => i.url === url);
    if (existing) return { error: `That link is already in your list: ${readingItemLabel(existing)}.`, existingId: existing.id };
    try {
      const item = await deps.addReadingItem(url);
      set({ items: [...state.items, item], error: null });
      return { item };
    } catch (failure) {
      return undo(failure);
    }
  }

  async function setTitle(id: number, title: string): Promise<ReadingResult> {
    const current = state.items.find((i) => i.id === id);
    const cleaned = cleanReadingTitle(title);
    if (!current || current.title !== "" || cleaned === null) return {};
    set({ items: state.items.map((i) => (i.id === id ? { ...i, title: cleaned } : i)) });
    try {
      replace(await deps.setReadingItemTitle(id, cleaned));
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function setRead(id: number, read: boolean): Promise<ReadingResult> {
    set({ items: state.items.map((i) => (i.id === id ? { ...i, read } : i)), error: null });
    try {
      replace(await deps.setReadingItemRead(id, read));
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  async function remove(id: number): Promise<ReadingResult> {
    set({ items: state.items.filter((i) => i.id !== id), error: null });
    try {
      await deps.deleteReadingItem(id);
      return {};
    } catch (error) {
      return undo(error);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    load,
    add,
    setTitle,
    setRead,
    remove,
  };
}

const UNAVAILABLE = "The Reading List is only available in the desktop app.";

/** For a workspace with no Reading List backend (the web app has no Reading List panel): loading it reports that. */
export const unavailableReadingList: ReadingListDeps = {
  listReadingItems: () => Promise.reject(new Error(UNAVAILABLE)),
  addReadingItem: () => Promise.reject(new Error(UNAVAILABLE)),
  setReadingItemTitle: () => Promise.reject(new Error(UNAVAILABLE)),
  setReadingItemRead: () => Promise.reject(new Error(UNAVAILABLE)),
  deleteReadingItem: () => Promise.reject(new Error(UNAVAILABLE)),
  clearReadingData: () => Promise.reject(new Error(UNAVAILABLE)),
};
