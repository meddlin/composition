import { isIP } from "node:net";

/**
 * Fetches a feed's text for the RSS Reader (docs/rss-reader-plan.md, D3-D5). The renderer has no network access
 * (`connect-src 'self'`), so this runs in the main process, and nothing it is given is trusted: the address was typed by a
 * person, the answer comes from a stranger's server.
 *
 * No Electron imports: `fetch` and the name lookup are passed in, so tests feed them canned answers.
 */

export const FEED_TIMEOUT_MS = 15_000;
export const FEED_MAX_BYTES = 5 * 1024 * 1024;
export const FEED_MAX_REDIRECTS = 5;

/** Said to the user as it is, so every message names what happened and, where it helps, what to do. */
export class FeedFetchError extends Error {}

export type FeedFetchDeps = {
  fetch: typeof fetch;
  /** Every address a host name resolves to. */
  lookup: (hostname: string) => Promise<string[]>;
  /** Lets private addresses through. Only for tests that serve a feed from this computer; never set in the shipped app. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
};

/** What the server told us last time, sent back so an unchanged feed costs one short answer. */
export type FeedValidators = { etag: string; lastModified: string };

export type FetchedFeed = { kind: "ok"; text: string; etag: string; lastModified: string } | { kind: "notModified" };

const PRIVATE_HOST_NAME = /(^|\.)(localhost|local|internal|home\.arpa)$/i;

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // shared (carrier-grade NAT)
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // protocol assignments
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  // A trailing dotted IPv4 (::ffff:1.2.3.4) is two groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4Parts(dotted[2]);
    if (!v4) return null;
    text = `${dotted[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

/** Whether an address is this computer or somewhere on a private network, rather than the public internet. Unreadable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ipv4Parts(ip);
    return parts === null || isPrivateIpv4(parts);
  }
  if (family === 6) {
    const g = ipv6Groups(ip);
    if (g === null) return true;
    const embedded = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
    const firstFiveZero = g.slice(0, 5).every((x) => x === 0);
    // ::, ::1, IPv4-compatible (::a.b.c.d) and IPv4-mapped (::ffff:a.b.c.d): judged by the IPv4 inside.
    if (firstFiveZero && (g[5] === 0 || g[5] === 0xffff)) return isPrivateIpv4(embedded);
    // NAT64 (64:ff9b::/96) carries an IPv4 address as well.
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIpv4(embedded);
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
  }
  return true;
}

const PRIVATE_MESSAGE = "That address points to this computer or a private network. Feeds are only fetched from the public internet.";

async function assertPublicHost(url: URL, deps: FeedFetchDeps): Promise<void> {
  if (deps.allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) throw new FeedFetchError(PRIVATE_MESSAGE);
    return;
  }
  if (PRIVATE_HOST_NAME.test(host)) throw new FeedFetchError(PRIVATE_MESSAGE);
  let addresses: string[];
  try {
    addresses = await deps.lookup(host);
  } catch {
    throw new FeedFetchError(`Could not find ${host}. Check the address and your connection.`);
  }
  if (addresses.length === 0) throw new FeedFetchError(`Could not find ${host}. Check the address and your connection.`);
  if (addresses.some(isPrivateAddress)) throw new FeedFetchError(PRIVATE_MESSAGE);
}

const isAbort = (error: unknown): boolean => error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

/** Reads the body up to the cap, counting as it arrives, so a server that never stops cannot fill memory. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const tooBig = () => new FeedFetchError(`That feed is larger than ${Math.round(maxBytes / (1024 * 1024))} MB, which is more than Composition will read.`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** The text of a body: the charset the server named, else the one the XML declaration names, else UTF-8. */
export function decodeFeedBody(body: Uint8Array, contentType: string | null): string {
  const named = contentType?.match(/charset\s*=\s*"?([\w.:-]+)"?/i)?.[1];
  const utf8 = new TextDecoder("utf-8").decode(body);
  const declared = utf8.slice(0, 200).match(/^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i)?.[1];
  const label = named ?? declared;
  if (!label || /^utf-?8$/i.test(label)) return utf8;
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return utf8;
  }
}

const ACCEPT = "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5";

/**
 * Fetches the feed at `address`. Redirects are followed by hand, up to a few, and each hop is checked again (a feed on a
 * public host may redirect to a private one). Throws `FeedFetchError` with a message fit to show; never returns a body
 * from a non-web address, a private address, a failed status, or one over the size cap.
 */
export async function fetchFeedText(address: string, validators: FeedValidators | null, deps: FeedFetchDeps): Promise<FetchedFeed> {
  const maxBytes = deps.maxBytes ?? FEED_MAX_BYTES;
  const maxRedirects = deps.maxRedirects ?? FEED_MAX_REDIRECTS;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FEED_TIMEOUT_MS);
  const headers: Record<string, string> = { "User-Agent": deps.userAgent ?? "Composition", Accept: ACCEPT };
  if (validators?.etag) headers["If-None-Match"] = validators.etag;
  if (validators?.lastModified) headers["If-Modified-Since"] = validators.lastModified;

  let current = address;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw new FeedFetchError("That does not look like an address.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new FeedFetchError("Only web addresses (http or https) can be fetched.");
    if (url.username !== "" || url.password !== "") throw new FeedFetchError("Remove the user name and password from the address.");
    await assertPublicHost(url, deps);

    try {
      const response = await deps.fetch(url.href, { headers, redirect: "manual", signal });
      if (response.status === 304) return { kind: "notModified" };
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        if (!location) throw new FeedFetchError(`The server answered ${response.status} without saying where to go.`);
        current = new URL(location, url).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new FeedFetchError(`The server answered ${response.status}.`);
      }
      const body = await readCapped(response, maxBytes);
      return {
        kind: "ok",
        text: decodeFeedBody(body, response.headers.get("content-type")),
        etag: response.headers.get("etag") ?? "",
        lastModified: response.headers.get("last-modified") ?? "",
      };
    } catch (error) {
      if (error instanceof FeedFetchError) throw error;
      if (isAbort(error)) throw new FeedFetchError("The server took too long to answer.");
      throw new FeedFetchError(`Could not reach ${url.hostname}. Check the address and your connection.`);
    }
  }
  throw new FeedFetchError("The address redirects too many times.");
}
