/**
 * YouTube's player won't start without knowing which site embeds it, and says so with "Error 153".
 * The app's pages live at `app://composition/`, which Chromium never sends as a referrer (only
 * http(s) pages are), so embeds from a note arrive with none. This gives requests for the player's
 * page, and only those, a referrer to go with the origin the preview names it by.
 *
 * The player is what the CSP's `frame-src` allows (protocol.ts); `<YouTube>` builds its address in
 * mdx/youtubeRef.ts.
 */
export const EMBED_URL_PATTERN = "https://www.youtube-nocookie.com/embed/*";

/** What the request says the embedding page is. Not a real site: any valid http(s) address will do. */
export const EMBED_REFERER = "https://composition.localhost/";

/** The slice of Electron's `session.webRequest` this uses, so it is tested without Electron. */
export type WebRequestHooks = {
  onBeforeSendHeaders: (
    filter: { urls: string[] },
    listener: (
      details: { requestHeaders: Record<string, string> },
      callback: (response: { requestHeaders: Record<string, string> }) => void,
    ) => void,
  ) => void;
};

export function installEmbedReferer(webRequest: WebRequestHooks): void {
  webRequest.onBeforeSendHeaders({ urls: [EMBED_URL_PATTERN] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, Referer: EMBED_REFERER } });
  });
}
