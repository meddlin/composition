import path from "node:path";

/**
 * Maps a request path on the app:// origin to a file in the exported renderer
 * (apps/web, COMPOSITION_TARGET=desktop). Returns null when nothing matches.
 *
 * Next exports `/settings` as `settings/index.html` (trailingSlash), but a
 * link or reload can arrive with or without the slash, so both work. The
 * result is always inside `root`: a path that resolves outside it (`..`,
 * encoded separators, NUL bytes) is treated as not found.
 */
export function resolveRendererFile(
  root: string,
  pathname: string,
  isFile: (absolutePath: string) => boolean,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;

  const relative = decoded.replace(/^\/+/, "");
  const candidates =
    relative === "" || relative.endsWith("/")
      ? [`${relative}index.html`]
      : [relative, `${relative}/index.html`, `${relative}.html`];

  const base = path.resolve(root);
  for (const candidate of candidates) {
    const full = path.resolve(base, candidate);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    if (isFile(full)) return full;
  }
  return null;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

export function mimeTypeFor(file: string): string {
  return MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
