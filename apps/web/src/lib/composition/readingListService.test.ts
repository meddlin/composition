import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Meilisearch isn't running in tests; indexing is best-effort, so a stub keeps the suite quiet.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "Search is unavailable.",
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-reading-list-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("the Reading List service", () => {
  it("starts with no links", async () => {
    const { listReadingItems } = await import("./readingListService");

    expect(await listReadingItems()).toEqual([]);
  });

  it("adds links as they are normalized, unread and untitled, and lists them oldest first", async () => {
    const { addReadingItem, listReadingItems } = await import("./readingListService");

    const first = await addReadingItem("  example.com/a#top ");
    await addReadingItem("https://example.org/b");

    expect(first).toMatchObject({ url: "https://example.com/a", title: "", read: false });
    expect((await listReadingItems()).map((i) => i.url)).toEqual(["https://example.com/a", "https://example.org/b"]);
  });

  it("refuses an address that is not a web page", async () => {
    const { addReadingItem, listReadingItems } = await import("./readingListService");

    await expect(addReadingItem("javascript:alert(1)")).rejects.toThrow(/web links/);
    await expect(addReadingItem("file:///etc/passwd")).rejects.toThrow(/web links/);
    await expect(addReadingItem("")).rejects.toThrow();
    expect(await listReadingItems()).toEqual([]);
  });

  it("refuses a link already in the list, however it is typed, and says which one it is", async () => {
    const { addReadingItem, listReadingItems, setReadingItemTitle } = await import("./readingListService");
    const first = await addReadingItem("https://example.com/a");
    await setReadingItemTitle(first.id, "A post");

    await expect(addReadingItem("example.com/a#later")).rejects.toThrow(/already in your list: A post/);
    expect(await listReadingItems()).toHaveLength(1);
  });

  it("fills in a title once, and keeps it when a later page offers another", async () => {
    const { addReadingItem, setReadingItemTitle } = await import("./readingListService");
    const item = await addReadingItem("https://example.com/a");

    expect((await setReadingItemTitle(item.id, "  A \n post ")).title).toBe("A post");
    expect((await setReadingItemTitle(item.id, "Somewhere else")).title).toBe("A post");
  });

  it("leaves a link untitled when the page's title is empty", async () => {
    const { addReadingItem, setReadingItemTitle } = await import("./readingListService");
    const item = await addReadingItem("https://example.com/a");

    expect((await setReadingItemTitle(item.id, "  ")).title).toBe("");
  });

  it("marks a link read and unread", async () => {
    const { addReadingItem, setReadingItemRead } = await import("./readingListService");
    const item = await addReadingItem("https://example.com/a");

    expect((await setReadingItemRead(item.id, true)).read).toBe(true);
    expect((await setReadingItemRead(item.id, false)).read).toBe(false);
  });

  it("says when a link is gone instead of changing nothing quietly", async () => {
    const { setReadingItemRead, setReadingItemTitle } = await import("./readingListService");

    await expect(setReadingItemRead(99, true)).rejects.toThrow(/no longer/);
    await expect(setReadingItemTitle(99, "x")).rejects.toThrow(/no longer/);
  });

  it("deletes a link for good, and deleting one that is gone is not an error", async () => {
    const { addReadingItem, deleteReadingItem, listReadingItems } = await import("./readingListService");
    const item = await addReadingItem("https://example.com/a");
    await addReadingItem("https://example.com/b");

    await deleteReadingItem(item.id);
    await deleteReadingItem(item.id);

    expect((await listReadingItems()).map((i) => i.url)).toEqual(["https://example.com/b"]);
    // Re-adding a deleted link is allowed: it is not kept anywhere.
    await expect(addReadingItem("https://example.com/a")).resolves.toMatchObject({ read: false });
  });
});
