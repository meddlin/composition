import { cleanReadingTitle, normalizeReadingUrl, readingItemLabel } from "./readingList";
import type { ReadingListApi } from "./readingListApi";
import * as readingListRepo from "./readingListRepo";

/**
 * The desktop app's Reading List links, kept in the notes database. `clearReadingData` is not here: it wipes a browser
 * session, which only the main process has, so it supplies that one itself.
 */
export type ReadingListService = Omit<ReadingListApi, "clearReadingData">;

export const listReadingItems: ReadingListService["listReadingItems"] = async () => readingListRepo.listReadingItems();

export const addReadingItem: ReadingListService["addReadingItem"] = async (input) => {
  const { url, error } = normalizeReadingUrl(input);
  if (error !== undefined) throw new Error(error);
  const existing = readingListRepo.findReadingItemByUrl(url);
  if (existing) throw new Error(`That link is already in your list: ${readingItemLabel(existing)}.`);
  return readingListRepo.addReadingItem(url);
};

export const setReadingItemTitle: ReadingListService["setReadingItemTitle"] = async (id, title) => {
  const current = readingListRepo.getReadingItem(id);
  if (!current) throw new Error("That link is no longer in your list.");
  // A title is only filled in. Once a page has named the link, opening another page from it does not rename it.
  const cleaned = cleanReadingTitle(title);
  if (current.title !== "" || cleaned === null) return current;
  return readingListRepo.updateReadingItem(id, { title: cleaned }) ?? current;
};

export const setReadingItemRead: ReadingListService["setReadingItemRead"] = async (id, read) => {
  const item = readingListRepo.updateReadingItem(id, { read });
  if (!item) throw new Error("That link is no longer in your list.");
  return item;
};

export const deleteReadingItem: ReadingListService["deleteReadingItem"] = async (id) => {
  readingListRepo.deleteReadingItem(id);
};
