/**
 * Where "Include pre-release versions" looks for updates (docs/desktop-updates-plan.md, U8).
 *
 * The normal feed is GitHub's "latest release" redirect, which never points at a pre-release.
 * With pre-releases on, the app asks GitHub's release list for the newest published desktop
 * release (pre-release or not) and reads its update file straight from that release's download
 * folder. Only GitHub is contacted, and nothing about the person or their notes is sent.
 *
 * No Electron imports: `fetch` is passed in, so tests feed it canned responses.
 */

export const RELEASE_REPO = "meddlin/composition";

/** Must match `publish.url` in electron-builder.yml; a test checks that they do. */
export const STABLE_FEED_URL = `https://github.com/${RELEASE_REPO}/releases/latest/download`;

/** Releases for other products in this repo (the CLI) are not ours to offer. */
const DESKTOP_TAG_PREFIX = "desktop-v";

/** A generic-provider feed: the folder holding the update file, and which update file to read. */
export type ReleaseFeed = { url: string; channel: string };

type GitHubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  assets?: unknown;
};

/**
 * Picks the newest published desktop release that carries a macOS update file. GitHub lists
 * releases newest first, so the first match wins. The update file's name is the channel:
 * `latest-mac.yml` is channel "latest", `beta-mac.yml` (what electron-builder writes for a
 * `1.0.0-beta.1` version) is channel "beta".
 */
export function pickRelease(releases: unknown): ReleaseFeed | null {
  if (!Array.isArray(releases)) return null;
  for (const release of releases as GitHubRelease[]) {
    if (release?.draft === true) continue;
    const tag = release?.tag_name;
    if (typeof tag !== "string" || !tag.startsWith(DESKTOP_TAG_PREFIX)) continue;
    const assets = Array.isArray(release.assets) ? (release.assets as { name?: unknown }[]) : [];
    for (const asset of assets) {
      const name = asset?.name;
      if (typeof name === "string" && /^[a-z0-9.]+-mac\.yml$/i.test(name)) {
        return {
          url: `https://github.com/${RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}`,
          channel: name.slice(0, -"-mac.yml".length),
        };
      }
    }
  }
  return null;
}

/** Asks GitHub for the newest release to update from, pre-releases included; null when there is none. */
export async function findLatestRelease(fetchJson: typeof fetch = fetch): Promise<ReleaseFeed | null> {
  const response = await fetchJson(`https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw Object.assign(new Error(`GitHub answered ${response.status} when listing releases`), {
      statusCode: response.status,
    });
  }
  return pickRelease(await response.json());
}
