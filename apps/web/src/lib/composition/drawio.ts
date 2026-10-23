/**
 * Talking to the draw.io editor, which a note's diagrams are drawn in. The editor runs in an iframe
 * (vendored; see drawio.lock.json) and is driven over `postMessage` in draw.io's "embed" JSON
 * protocol. Everything here is pure, so it is tested without a browser.
 *
 * A diagram is stored as a PNG with the diagram's XML embedded in it (draw.io's `xmlpng`): an
 * ordinary stored image (images.ts) that the editor can also open again.
 */

/** What a new diagram starts as: one empty layer. */
export const BLANK_DIAGRAM_XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

/** The name given to the file when it is stored; the note's title and a content hash are added (images.ts). */
export const DIAGRAM_FILE_NAME = "diagram.png";

/** A diagram is stored at twice the size it is drawn at (see exportMessage). */
export const DIAGRAM_DENSITY = 2;

/** The alt text a new diagram starts with. */
export const DIAGRAM_ALT = "Diagram";

/**
 * The editor's address: `base` is where its files are served from (drawioBase.ts). The options keep
 * it offline and self-contained (`offline`, `stealth`: nothing is fetched from draw.io's servers or
 * Google; `pwa`: no service worker), and in "embed" mode with the JSON protocol, which is what `parseDrawioMessage` and the
 * messages below speak. Its own Save, Exit and Open buttons are hidden: the dialog has them.
 */
export function drawioEditorUrl(base: string, options: { dark: boolean }): string {
  const params = new URLSearchParams({
    embed: "1",
    proto: "json",
    spin: "1",
    offline: "1",
    stealth: "1",
    // `offline` also switches on the editor's service worker (its installable-app mode), which this has no use for.
    pwa: "0",
    ui: "min",
    noSaveBtn: "1",
    noExitBtn: "1",
    dark: options.dark ? "1" : "0",
    lang: "en",
  });
  return `${base}index.html?${params}`;
}

/** The origin messages from the editor must come from, for a `base` that is a path or an absolute address. */
export function drawioOrigin(base: string, pageOrigin: string): string {
  // `new URL(...).origin` is "null" for a custom scheme such as app://, which is what a message event reports instead.
  return /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(base)?.[0] ?? pageOrigin;
}

export type DrawioMessage = { event: string; [key: string]: unknown };

/** An editor message, or null when it isn't one (the editor sends JSON text; something else on the page may send anything). */
export function parseDrawioMessage(data: unknown): DrawioMessage | null {
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const event = (value as { event?: unknown }).event;
  return typeof event === "string" ? (value as DrawioMessage) : null;
}

/**
 * Shows a diagram in the editor, from a stored PNG (a `data:` address of one) or from nothing for a
 * new one. `autosave` has it report every change, so the dialog knows there is something to lose.
 */
export function loadMessage(pngDataUri: string | null): string {
  return JSON.stringify(
    pngDataUri === null ? { action: "load", autosave: 1, xml: BLANK_DIAGRAM_XML } : { action: "load", autosave: 1, xmlpng: pngDataUri },
  );
}

/**
 * Asks for the diagram as a PNG with its XML inside. Twice the size, so text stays sharp, and on
 * white: the picture is shown on every color scheme, and a transparent one would vanish on a dark one.
 */
export function exportMessage(): string {
  return JSON.stringify({ action: "export", format: "xmlpng", scale: DIAGRAM_DENSITY, border: 10, background: "#ffffff", spin: "Saving" });
}

const DATA_URI_PNG = /^data:image\/png;base64,/;

/** The bytes of an `export` message's `data`, or null when it isn't a PNG data address. */
export function pngBytesFromDataUri(uri: unknown): Uint8Array | null {
  if (typeof uri !== "string" || !DATA_URI_PNG.test(uri)) return null;
  try {
    const binary = atob(uri.slice(uri.indexOf(",") + 1));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function dataUriFromPngBytes(bytes: Uint8Array): string {
  let binary = "";
  // In slices: spreading a whole screenshot's worth of bytes into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Whether a PNG carries a draw.io diagram: a `tEXt` chunk named `mxfile`. Only such a picture can be
 * opened in the editor; any other would be loaded as a plain image to draw on.
 */
export function hasEmbeddedDiagram(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const KEYWORD = "mxfile\u0000";
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "tEXt" && String.fromCharCode(...bytes.subarray(at + 8, at + 8 + Math.min(length, KEYWORD.length))) === KEYWORD) {
      return true;
    }
    if (type === "IEND") return false;
    at += 12 + length;
  }
  return false;
}
