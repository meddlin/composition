import { MAX_READING_TITLE_LENGTH, MAX_READING_URL_LENGTH, type ReadingItem } from "./readingListApi";

/** The schemes that are named without `//`, which the "no scheme, so add https://" rule must not mistake for a host and port. */
const OPAQUE_SCHEME = /^(javascript|data|file|blob|about|mailto|tel|vbscript|view-source|chrome|devtools|app):/i;
const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * A link as it is stored: trimmed, `https://` added when there is no scheme, the fragment dropped. Only `http:` and `https:`
 * pass; anything else (`javascript:`, `file:`, `app:`) is refused, because the address becomes a navigation in a web view.
 * The renderer, the bridge validator and the service all use it, so none can let through what another refuses.
 */
export function normalizeReadingUrl(input: string): { url: string; error?: undefined } | { url?: undefined; error: string } {
  const text = input.trim();
  if (text === "") return { error: "Paste a link to add." };
  if (text.length > MAX_READING_URL_LENGTH) return { error: "That link is too long." };
  if (OPAQUE_SCHEME.test(text)) return { error: "Only web links (http or https) can be added." };
  let parsed: URL;
  try {
    parsed = new URL(SCHEME_WITH_SLASHES.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "That does not look like a link." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { error: "Only web links (http or https) can be added." };
  if (parsed.hostname === "") return { error: "That does not look like a link." };
  if (parsed.username !== "" || parsed.password !== "") return { error: "Remove the user name and password from the link." };
  parsed.hash = "";
  return { url: parsed.href };
}

/** What to call a link until its page has said: the host name, without a leading `www.`. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
}

/** What a row is called: the page's title when it has one, else the host. */
export function readingItemLabel(item: Pick<ReadingItem, "url" | "title">): string {
  return item.title === "" ? hostLabel(item.url) : item.title;
}

/** A page title as it is stored: on one line, trimmed, cut at the limit. Null when nothing is left. */
export function cleanReadingTitle(title: string): string | null {
  const cleaned = title.replace(/\s+/g, " ").trim().slice(0, MAX_READING_TITLE_LENGTH).trimEnd();
  return cleaned === "" ? null : cleaned;
}

/** The list as it is shown: unread first, then read, each oldest first. */
export function sortReadingItems(items: readonly ReadingItem[]): ReadingItem[] {
  return [...items].sort((a, b) => Number(a.read) - Number(b.read) || a.id - b.id);
}
