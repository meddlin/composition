import fs from "node:fs";
import path from "node:path";

/** One Markdown file under the repository's `docs/` directory. */
export type DocEntry = {
  /** URL segments below /docs; empty for docs/index.md. */
  slug: string[];
  /** Posix path relative to the docs directory, e.g. "architecture/groups.md". */
  relPath: string;
  title: string;
};

/**
 * The repo-level `docs/` directory. The web app runs with apps/web as its
 * working directory, so the docs sit two levels up; COMPOSITION_DOCS_DIR
 * overrides that for other layouts.
 */
export function docsDir(): string {
  return process.env.COMPOSITION_DOCS_DIR ?? path.resolve(process.cwd(), "../../docs");
}

function titleOf(content: string, fallback: string): string {
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(content);
  return heading ? heading[1] : fallback;
}

function slugOf(relPath: string): string[] {
  const parts = relPath.replace(/\.md$/, "").split("/");
  return parts[parts.length - 1] === "index" ? parts.slice(0, -1) : parts;
}

function collect(root: string, dir: string, out: DocEntry[]): void {
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      collect(root, full, out);
    } else if (dirent.isFile() && dirent.name.endsWith(".md")) {
      const relPath = path.relative(root, full).split(path.sep).join("/");
      const content = fs.readFileSync(full, "utf8");
      out.push({ slug: slugOf(relPath), relPath, title: titleOf(content, dirent.name) });
    }
  }
}

/** Every doc, the index first, then top-level files, then each subdirectory. */
export function listDocs(root: string = docsDir()): DocEntry[] {
  if (!fs.existsSync(root)) return [];
  const entries: DocEntry[] = [];
  collect(root, root, entries);
  const rank = (e: DocEntry) => (e.relPath === "index.md" ? 0 : e.relPath.includes("/") ? 2 : 1);
  return entries.sort((a, b) => rank(a) - rank(b) || a.relPath.localeCompare(b.relPath));
}

/**
 * Looks the slug up in the listing rather than joining it onto a path, so a
 * crafted URL can never reach a file outside the docs directory.
 */
export function readDoc(
  slug: string[],
  root: string = docsDir(),
): { entry: DocEntry; content: string } | null {
  const key = slug.join("/");
  const entry = listDocs(root).find((e) => e.slug.join("/") === key);
  if (!entry) return null;
  return { entry, content: fs.readFileSync(path.join(root, entry.relPath), "utf8") };
}

export function docHref(entry: DocEntry): string {
  return entry.slug.length === 0 ? "/docs" : `/docs/${entry.slug.join("/")}`;
}

/**
 * Maps a relative link in a doc (e.g. "../search.md#ranking") to the route of
 * the doc it points at. Returns null for anything that isn't a known doc:
 * external URLs, source-file links, unknown targets.
 */
export function resolveDocLink(from: DocEntry, href: string, docs: DocEntry[]): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/") || href.startsWith("#")) return null;
  const [target, hash] = href.split("#");
  if (!target.endsWith(".md")) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from.relPath), target));
  const entry = docs.find((e) => e.relPath === resolved);
  return entry ? docHref(entry) + (hash ? `#${hash}` : "") : null;
}
