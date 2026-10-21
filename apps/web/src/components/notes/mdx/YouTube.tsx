import { parseYouTube, youtubeEmbedUrl } from "./youtubeRef";

/**
 * A YouTube video you can watch in the preview: `<YouTube url="https://youtu.be/dQw4w9WgXcQ" />`.
 * `url` is any link to the video, or just its id; `start` (`90`, `1:30`, `1m30s`) begins playback
 * part-way in, and `title` names the player for screen readers.
 *
 * Only the video id is used: the player's address is built from it (see youtubeRef.ts), so a note
 * can't point the frame anywhere else. A reference that can't be read shows as a notice, like an
 * image that is missing, rather than vanishing while it is half-typed.
 *
 * A span rather than a div, so it is also valid in the middle of a paragraph; it is drawn as a block.
 */
export function YouTube({ url, start, title }: { url?: string; start?: string; title?: string }) {
  const ref = parseYouTube(url, start);

  if (!ref) {
    return (
      <span role="img" aria-label="YouTube video not found" className="not-prose my-4 block text-muted-foreground italic">
        {url?.trim() ? `Not a YouTube video: ${url.trim()}` : "YouTube video: add a url"}
      </span>
    );
  }

  return (
    <span className="not-prose my-4 block aspect-video w-full max-w-full overflow-hidden rounded-md border bg-muted">
      <iframe
        src={youtubeEmbedUrl(ref)}
        title={title?.trim() || "YouTube video"}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="size-full border-0"
      />
    </span>
  );
}
