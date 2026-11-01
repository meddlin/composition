import { describe, expect, it, vi } from "vitest";
import type { ReadingItem, ReadingListApi } from "./readingListApi";
import { createReadingListStore } from "./readingListStore";

const make = (id: number, url: string, over: Partial<ReadingItem> = {}): ReadingItem => ({ id, url, title: "", read: false, createdAt: "", updatedAt: "", ...over });

/** A backend that keeps its links in memory, like the real one does in a database. */
function fakeBackend(initial: ReadingItem[] = []) {
  let items = [...initial];
  let nextId = 100;
  const api = {
    listReadingItems: vi.fn(async () => items),
    addReadingItem: vi.fn(async (url: string) => {
      const created = make(nextId++, url);
      items = [...items, created];
      return created;
    }),
    setReadingItemTitle: vi.fn(async (id: number, title: string) => {
      items = items.map((i) => (i.id === id ? { ...i, title } : i));
      return items.find((i) => i.id === id)!;
    }),
    setReadingItemRead: vi.fn(async (id: number, read: boolean) => {
      items = items.map((i) => (i.id === id ? { ...i, read } : i));
      return items.find((i) => i.id === id)!;
    }),
    deleteReadingItem: vi.fn(async (id: number) => {
      items = items.filter((i) => i.id !== id);
    }),
    clearReadingData: vi.fn(async () => {}),
  } satisfies ReadingListApi;
  return { api, stored: () => items };
}

async function loaded(initial: ReadingItem[] = []) {
  const backend = fakeBackend(initial);
  const store = createReadingListStore(backend.api);
  await store.load();
  return { ...backend, store };
}

describe("the Reading List store", () => {
  it("starts idle, loads once, and tells the listeners", async () => {
    const { api } = fakeBackend([make(1, "https://a.example/")]);
    const store = createReadingListStore(api);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot().status).toBe("idle");

    await Promise.all([store.load(), store.load()]);
    await store.load();

    expect(store.getSnapshot()).toMatchObject({ status: "ready", items: [{ id: 1 }], error: null });
    expect(api.listReadingItems).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
  });

  it("reports a failed load as unknown rather than empty, and tries again next time", async () => {
    const { api } = fakeBackend();
    api.listReadingItems.mockRejectedValueOnce(new Error("Disk gone."));
    const store = createReadingListStore(api);

    await store.load();
    expect(store.getSnapshot()).toMatchObject({ status: "error", error: "Disk gone." });

    await store.load();
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("adds a link as it is normalized", async () => {
    const { store, api } = await loaded();

    const result = await store.add(" example.com/a#top ");

    expect(result.item).toMatchObject({ url: "https://example.com/a" });
    expect(api.addReadingItem).toHaveBeenCalledWith("https://example.com/a");
    expect(store.getSnapshot().items.map((i) => i.url)).toEqual(["https://example.com/a"]);
  });

  it("refuses a bad address without asking the backend", async () => {
    const { store, api } = await loaded();

    expect((await store.add("javascript:alert(1)")).error).toMatch(/web links/);
    expect((await store.add("  ")).error).toBeTruthy();
    expect(api.addReadingItem).not.toHaveBeenCalled();
  });

  it("refuses a link already in the list and says which one it is", async () => {
    const { store, api } = await loaded([make(7, "https://example.com/a", { title: "A post" })]);

    const result = await store.add("example.com/a#again");

    expect(result.error).toMatch(/already in your list: A post/);
    expect(result.existingId).toBe(7);
    expect(api.addReadingItem).not.toHaveBeenCalled();
  });

  it("fills in a title once, at once, and sends nothing for a link that has one", async () => {
    const { store, api } = await loaded([make(1, "https://a.example/"), make(2, "https://b.example/", { title: "Named" })]);

    const pending = store.setTitle(1, " A \n post ");
    expect(store.getSnapshot().items[0].title).toBe("A post");
    await pending;
    await store.setTitle(2, "Another");
    await store.setTitle(1, "   ");

    expect(api.setReadingItemTitle).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().items.map((i) => i.title)).toEqual(["A post", "Named"]);
  });

  it("shows a change of read at once", async () => {
    const { store, stored } = await loaded([make(1, "https://a.example/")]);

    const pending = store.setRead(1, true);
    expect(store.getSnapshot().items[0].read).toBe(true);
    await pending;

    expect(stored()[0].read).toBe(true);
  });

  it("removes a link at once", async () => {
    const { store, stored } = await loaded([make(1, "https://a.example/"), make(2, "https://b.example/")]);

    const pending = store.remove(1);
    expect(store.getSnapshot().items.map((i) => i.id)).toEqual([2]);
    await pending;

    expect(stored().map((i) => i.id)).toEqual([2]);
  });

  it("puts back what is really stored, and says why, when the backend refuses a change", async () => {
    const { store, api } = await loaded([make(1, "https://a.example/")]);
    api.setReadingItemRead.mockRejectedValueOnce(new Error("That link is no longer in your list."));

    const result = await store.setRead(1, true);

    expect(result.error).toMatch(/no longer/);
    expect(store.getSnapshot()).toMatchObject({ items: [{ id: 1, read: false }], error: expect.stringMatching(/no longer/) });
  });

  it("puts back a link the backend would not delete", async () => {
    const { store, api } = await loaded([make(1, "https://a.example/")]);
    api.deleteReadingItem.mockRejectedValueOnce(new Error("Disk is full."));

    await store.remove(1);

    expect(store.getSnapshot().items.map((i) => i.id)).toEqual([1]);
  });
});
