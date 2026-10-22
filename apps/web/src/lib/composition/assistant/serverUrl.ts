export const DEFAULT_SERVER_URL = "http://127.0.0.1:11434";

export type ParsedServerUrl = { ok: true; url: string } | { ok: false; error: string };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const NOT_AN_ADDRESS = "Enter an address like http://192.168.1.5:11434 (http or https).";

/**
 * The Fetch Standard's "bad ports" (section "Port blocking"). Node's fetch refuses to connect to them and
 * fails with "bad port", whatever is listening, so an address using one can never work. Port 0 is not
 * listed: it is not a valid port to connect to and `URL` already rejects it.
 */
const BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/**
 * Checks and normalizes the address of an Ollama server: scheme and host (lowercased), the port unless it is the
 * scheme's default, and an optional path prefix for a reverse proxy, with no trailing slash. A blank input means
 * the default address. The server never sees a user name or password, a query or a fragment.
 */
export function parseServerUrl(input: string): ParsedServerUrl {
  const text = input.trim();
  if (text === "") return { ok: true, url: DEFAULT_SERVER_URL };

  let url: URL;
  try {
    url = new URL(HAS_SCHEME.test(text) ? text : `http://${text}`);
  } catch {
    return { ok: false, error: NOT_AN_ADDRESS };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https addresses are supported." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, error: "Leave the user name and password out of the address; this version sends no credentials." };
  }
  if (BLOCKED_PORTS.has(Number(url.port))) {
    return { ok: false, error: `Port ${url.port} can't be used: web requests to it are blocked. Ollama's own port is 11434.` };
  }
  return { ok: true, url: url.origin + url.pathname.replace(/\/+$/, "") };
}

const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

/**
 * Whether the address is this machine (so notes sent to it do not cross a network). `0.0.0.0` counts: connecting
 * to it reaches the local machine. Anything that is not an address counts as another machine.
 */
export function isLoopback(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    IPV4_LOOPBACK.test(host)
  );
}
