/**
 * Checks for the web app's non-Server-Action endpoints: the attachment upload
 * (`/api/notes/[noteId]/attachments`) and the AI helper's chat stream
 * (`/api/assistant/chat`). Server Actions have Next's own cross-site
 * protection; a plain route handler does not, so without this any web page the
 * user visits could POST a file, or a question about a note, to `localhost`.
 *
 * Two rules, both cheap: the request must carry a header only our own script
 * sends (a cross-site page can't add one without a CORS preflight, which this
 * app never approves), and a browser-supplied `Origin` must be this host.
 */

export const UPLOAD_HEADER = "x-composition-upload";
export const ASSISTANT_HEADER = "x-composition-assistant";

function sameOriginRefusal(headers: Headers, header: string, notFrom: string): string | null {
  if (headers.get(header) !== "1") return `Not from the Composition app.`;
  const origin = headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return notFrom;
    }
    if (originHost !== headers.get("host")) return notFrom;
  }
  return null;
}

/** Returns an error message when the upload should be refused, or null when it may proceed. */
export function uploadRefusal(headers: Headers): string | null {
  return sameOriginRefusal(headers, UPLOAD_HEADER, "Uploads must come from the Composition app.");
}

/** Returns an error message when the chat request should be refused, or null when it may proceed. */
export function assistantRefusal(headers: Headers): string | null {
  return sameOriginRefusal(headers, ASSISTANT_HEADER, "Questions must come from the Composition app.");
}
