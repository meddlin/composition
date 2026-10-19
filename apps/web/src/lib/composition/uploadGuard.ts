/**
 * Checks for the web app's one non-Server-Action write endpoint, the
 * attachment upload (`/api/notes/[noteId]/attachments`). Server Actions have
 * Next's own cross-site protection; a plain route handler does not, so without
 * this any web page the user visits could POST a file to `localhost`.
 *
 * Two rules, both cheap: the request must carry a header only our own script
 * sends (a cross-site page can't add one without a CORS preflight, which this
 * app never approves), and a browser-supplied `Origin` must be this host.
 */

export const UPLOAD_HEADER = "x-composition-upload";

/** Returns an error message when the request should be refused, or null when it may proceed. */
export function uploadRefusal(headers: Headers): string | null {
  if (headers.get(UPLOAD_HEADER) !== "1") return "Not an upload from the Composition app.";
  const origin = headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return "Uploads must come from the Composition app.";
    }
    if (originHost !== headers.get("host")) return "Uploads must come from the Composition app.";
  }
  return null;
}
