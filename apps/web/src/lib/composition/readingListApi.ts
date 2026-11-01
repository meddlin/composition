/**
 * What the Reading List panel exchanges with the backend. Types only, apart from READING_LIST_METHODS, so it is safe to
 * import anywhere (renderer, preload, main). Desktop only, like the panels that show it.
 */

/** The partition the panel's pages live in (cookies, cache, storage). Kept apart from the app's own so a page never shares them. */
export const READING_LIST_PARTITION = "persist:reading-list";

/** The longest a link may be. The page limits its input to this; the backend refuses more. */
export const MAX_READING_URL_LENGTH = 2048;

/** The longest a stored title may be; a longer page title is cut. */
export const MAX_READING_TITLE_LENGTH = 300;

/** One link in the list. `title` is empty until the page has been opened once and has said what it is called. */
export type ReadingItem = {
  id: number;
  /** Always an absolute `http:` or `https:` address, as `normalizeReadingUrl` writes it. */
  url: string;
  title: string;
  read: boolean;
  createdAt: string;
  updatedAt: string;
};

export interface ReadingListApi {
  /** Every link, oldest first. */
  listReadingItems(): Promise<ReadingItem[]>;
  /** Adds a link at the end. Rejects an address that is not a web page, or one already in the list. */
  addReadingItem(url: string): Promise<ReadingItem>;
  /** Fills in the title of a link that has none; a link that has one keeps it. Rejects a missing item. */
  setReadingItemTitle(id: number, title: string): Promise<ReadingItem>;
  /** Marks the link read or unread. Rejects a missing item. */
  setReadingItemRead(id: number, read: boolean): Promise<ReadingItem>;
  /** Deletes the link, for good. Deleting one that is already gone is not an error. */
  deleteReadingItem(id: number): Promise<void>;
  /** Wipes what the pages stored: cookies, cache, local storage. The links are kept. */
  clearReadingData(): Promise<void>;
}

/** Every method of ReadingListApi, as data, so the preload script and the main process can't drift from it. */
export const READING_LIST_METHODS = [
  "listReadingItems",
  "addReadingItem",
  "setReadingItemTitle",
  "setReadingItemRead",
  "deleteReadingItem",
  "clearReadingData",
] as const satisfies readonly (keyof ReadingListApi)[];

export type ReadingListMethod = (typeof READING_LIST_METHODS)[number];

type MissingFromReadingListMethods = Exclude<keyof ReadingListApi, ReadingListMethod>;
const _everyMethodListed: [MissingFromReadingListMethods] extends [never] ? true : never = true;
void _everyMethodListed;
