/**
 * Reading a YouTube reference from a note. Pure and React-free, so the terminal app shares it
 * (through its backend.ts) and it is tested without a DOM.
 *
 * The embed address is always built here from the 11-character video id, never taken from what the
 * note says, so a note can only ever point the player at a YouTube video.
 */

const ID = /^[\w-]{11}$/;

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const SHORT_HOST = "youtu.be";
// `/embed/<id>`, `/shorts/<id>`, `/live/<id>` and `/v/<id>`.
const ID_PATHS = new Set(["embed", "shorts", "live", "v"]);

/** The video a note's reference points at: its id, and where to begin playing, in whole seconds. */
export type YouTubeRef = { id: string; start: number };

/**
 * A start time as a number of seconds: `90`, `90s`, `1:30`, `1:02:03` or `1m30s` (what `?t=` carries
 * in a YouTube link). Null for anything else, so a half-typed value plays from the start.
 */
export function parseStart(value: string | null | undefined): number | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  if (/^\d+s?$/.test(text)) return Number.parseInt(text, 10);
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(text);
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (units) return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  return null;
}

/**
 * What a note's `<YouTube url="…" start="…" />` points at. `url` is a watch link
 * (`youtube.com/watch?v=…`), a short link (`youtu.be/…`), an embed, shorts or live link, or the bare
 * video id. A start time in the link (`?t=90`) is used unless `start` is given. Null when it isn't a
 * YouTube video, or no id can be found.
 */
export function parseYouTube(url: string | undefined, start?: string): YouTubeRef | null {
  const text = url?.trim();
  if (!text) return null;
  const explicitStart = parseStart(start);

  if (ID.test(text)) return { id: text, start: explicitStart ?? 0 };

  let link: URL;
  try {
    link = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (link.protocol !== "https:" && link.protocol !== "http:") return null;

  const segments = link.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (link.hostname === SHORT_HOST) id = segments[0];
  else if (HOSTS.has(link.hostname)) {
    id = segments[0] === "watch" ? (link.searchParams.get("v") ?? undefined) : ID_PATHS.has(segments[0]) ? segments[1] : undefined;
  }
  if (!id || !ID.test(id)) return null;

  const fromLink = parseStart(link.searchParams.get("t") ?? link.searchParams.get("start"));
  return { id, start: explicitStart ?? fromLink ?? 0 };
}

/** The privacy-enhanced embed: YouTube sets no cookies until the video is played. */
export function youtubeEmbedUrl({ id, start }: YouTubeRef): string {
  const query = new URLSearchParams({ rel: "0" });
  if (start > 0) query.set("start", String(start));
  return `https://www.youtube-nocookie.com/embed/${id}?${query}`;
}

/** Where the video is on youtube.com, for opening it there (and what the terminal shows). */
export function youtubeWatchUrl({ id, start }: YouTubeRef): string {
  return `https://www.youtube.com/watch?v=${id}${start > 0 ? `&t=${start}s` : ""}`;
}
