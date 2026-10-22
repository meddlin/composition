/**
 * Reading a git repository reference from a note. Pure and React-free, so the terminal app shares it
 * (through its backend.ts) and it is tested without a DOM.
 *
 * Nothing is fetched: the card is drawn from the address alone. The link is always rebuilt here from
 * the host and path, as `https://host/path`, so a note can't smuggle in a script address, a login or
 * a query string.
 */

/** Hosts with a name of their own, and how deep their repository paths go (GitLab has subgroups). */
const KNOWN_HOSTS: Record<string, { service: string; nested: boolean }> = {
  "github.com": { service: "GitHub", nested: false },
  "gitlab.com": { service: "GitLab", nested: true },
  "bitbucket.org": { service: "Bitbucket", nested: false },
  "codeberg.org": { service: "Codeberg", nested: false },
  "git.sr.ht": { service: "SourceHut", nested: false },
};

// Where a repository's own path ends and a page inside it begins, on hosts we don't know the shape of.
// Only looked for after the first two segments, so a repository that happens to be called `src` is safe.
const PAGE_SEGMENTS = new Set(["-", "tree", "blob", "src", "raw", "commit", "commits", "issues", "pulls", "pull", "merge_requests", "releases", "wiki", "actions"]);

const SEGMENT = /^[\w.~-]+$/;
// `git@host:owner/repo.git`, the address `git clone` is given over ssh.
const SCP_LIKE = /^[\w.-]+@([\w.-]+):(?!\/)(.+)$/;
const WEB_PROTOCOLS = new Set(["https:", "http:"]);
const CLONE_PROTOCOLS = new Set(["ssh:", "git:"]);

/** The repository a note's reference points at. */
export type RepoRef = {
  /** Host, without a leading `www.`: `github.com`. */
  host: string;
  /** Who runs it, when we know the host: `GitHub`. Null for any other host. */
  service: string | null;
  /** Everything before the repository's name, without the trailing slash: `meddlin`, or `group/subgroup`. */
  owner: string;
  /** The repository's name, without `.git`. */
  name: string;
  /** Where to open it: `https://host/owner/name` (`http` when that is what was written). */
  href: string;
};

/**
 * What a note's `<Repo url="…" />` points at. `url` is the page you'd copy from the browser
 * (`github.com/owner/repo`, also with `/tree/main/…` after it), a clone address (`…/repo.git`,
 * `git@github.com:owner/repo.git`), with or without `https://`. Null when it isn't an address with
 * an owner and a repository name.
 */
export function parseRepo(url: string | undefined): RepoRef | null {
  const text = url?.trim();
  if (!text || /\s/.test(text)) return null;

  let host: string;
  let path: string;
  let protocol = "https:";
  const scp = SCP_LIKE.exec(text);
  if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    let link: URL;
    try {
      link = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    } catch {
      return null;
    }
    if (WEB_PROTOCOLS.has(link.protocol)) protocol = link.protocol;
    else if (!CLONE_PROTOCOLS.has(link.protocol)) return null;
    host = link.host;
    path = link.pathname;
  }

  host = host.toLowerCase().replace(/^www\./, "");
  // A name with no dot is a typo, not a host (`owner/repo` would otherwise read as host `owner`).
  if (!host.includes(".")) return null;

  const segments = path.split("/").filter(Boolean);
  const known = KNOWN_HOSTS[host];
  const end = known && !known.nested ? 2 : endOfRepoPath(segments);
  const repoPath = segments.slice(0, end);
  if (repoPath.length < 2 || !repoPath.every((segment) => SEGMENT.test(segment))) return null;

  const name = repoPath[repoPath.length - 1].replace(/\.git$/, "");
  if (!name || name === "." || name === "..") return null;
  const owner = repoPath.slice(0, -1).join("/");

  return { host, service: known?.service ?? null, owner, name, href: `${protocol}//${host}/${owner}/${name}` };
}

function endOfRepoPath(segments: string[]): number {
  const page = segments.findIndex((segment, index) => index >= 2 && PAGE_SEGMENTS.has(segment));
  return page === -1 ? segments.length : page;
}

/** `owner/name`, as the terminal app names the repository. */
export function repoLabel({ owner, name }: RepoRef): string {
  return `${owner}/${name}`;
}
