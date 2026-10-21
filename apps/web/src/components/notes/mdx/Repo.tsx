import { parseRepo } from "./repoRef";

// Two commits joined by a branch (a git "branch" glyph), drawn as strokes on a 24x24 grid.
const ICON = "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9";

/**
 * A git repository, drawn as a small card that opens it: `<Repo url="https://github.com/owner/name" />`.
 * `url` is the page or the clone address, on GitHub, GitLab, Bitbucket, Codeberg, SourceHut or any
 * other host; `description` says what the repository is for, since nothing is fetched from the host.
 *
 * The link is built from the parsed host and path (see repoRef.ts), never taken as written. A
 * reference that can't be read shows as a notice, like an image that is missing, rather than
 * vanishing while it is half-typed.
 *
 * A span rather than a div, so it is also valid in the middle of a paragraph; it is drawn as a block.
 */
export function Repo({ url, description }: { url?: string; description?: string }) {
  const ref = parseRepo(url);

  if (!ref) {
    return (
      <span role="img" aria-label="Repository not found" className="not-prose my-4 block text-muted-foreground italic">
        {url?.trim() ? `Not a repository address: ${url.trim()}` : "Repository: add a url"}
      </span>
    );
  }

  const summary = description?.trim();
  return (
    <a
      href={ref.href}
      target="_blank"
      rel="noopener noreferrer"
      className="not-prose group my-4 flex items-start gap-3 rounded-md border bg-card p-4 text-card-foreground no-underline transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
      >
        <path d={ICON} />
      </svg>
      <span className="block min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold group-hover:underline">
          {ref.owner}/{ref.name}
        </span>
        {summary ? <span className="mt-1 block text-sm text-muted-foreground">{summary}</span> : null}
        <span className="mt-1 block truncate text-xs text-muted-foreground">{ref.service ? `${ref.service} · ${ref.host}` : ref.host}</span>
      </span>
    </a>
  );
}
