import type { Failure } from "./errors";

/** The address a request goes to, and whether it is the saved alternate rather than the first address. */
export type Endpoint = { ok: true; url: string; alternate: boolean };

export type Resolved = Endpoint | { ok: false; failure: Failure };

export type EndpointAddresses = { serverUrl: string; alternateUrl?: string };

/**
 * How long to wait for the first address before trying the alternate. Short, because the usual reason for it not
 * answering is being away from the network it is on, where a packet gets no reply at all rather than a refusal.
 * A server on a home network answers in milliseconds.
 */
const FIRST_PROBE_MS = 1500;
/** The alternate may be a VPN address with a slower first hop. */
const ALTERNATE_PROBE_MS = 5000;
/** How long a choice is kept, so that a conversation does not probe before every message. */
const REMEMBER_MS = 10_000;

/**
 * Whether an Ollama server answers at `url`: `GET /api/version` returns `{ version }`. Anything else (no reply,
 * an error page from a proxy, another device that happens to have that address on the network you are on)
 * counts as not answering.
 */
export async function answers(url: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/version`, {
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { version?: unknown } | null;
    return typeof body?.version === "string";
  } catch {
    return false;
  }
}

/**
 * Picks which of the saved addresses to use: the first if it answers, otherwise the alternate, so the same
 * setup works at home and away. With no alternate it just returns the first, without any request. A choice is
 * remembered for a few seconds, and `forget` drops it (after a request to the chosen address found nothing there).
 * When neither answers, the failure names both.
 */
export function createEndpointResolver(probe: typeof answers = answers, now: () => number = Date.now) {
  let remembered: { key: string; until: number; endpoint: Endpoint } | undefined;
  let pending: { key: string; promise: Promise<Resolved> } | undefined;

  async function choose(first: string, alternate: string, signal?: AbortSignal): Promise<Resolved> {
    if (await probe(first, FIRST_PROBE_MS, signal)) return { ok: true, url: first, alternate: false };
    if (signal?.aborted) return { ok: false, failure: { kind: "aborted", message: "Stopped." } };
    if (await probe(alternate, ALTERNATE_PROBE_MS, signal)) return { ok: true, url: alternate, alternate: true };
    if (signal?.aborted) return { ok: false, failure: { kind: "aborted", message: "Stopped." } };
    return {
      ok: false,
      failure: {
        kind: "unreachable",
        message: `Couldn't reach Ollama at ${first} or at ${alternate}. Check that this computer is on the network for one of them (your home network, or Tailscale, say).`,
      },
    };
  }

  async function resolve(addresses: EndpointAddresses, signal?: AbortSignal): Promise<Resolved> {
    const { serverUrl, alternateUrl } = addresses;
    if (alternateUrl === undefined) return { ok: true, url: serverUrl, alternate: false };

    const key = `${serverUrl}\n${alternateUrl}`;
    if (remembered?.key === key && now() < remembered.until) return remembered.endpoint;
    // A second caller asking while the first probes shares its answer. (If that first caller stops, so does
    // the probe, and this one gets a "Stopped" it did not ask for; asking again probes afresh.)
    if (pending?.key === key) return pending.promise;

    const promise = choose(serverUrl, alternateUrl, signal).then((resolved) => {
      if (resolved.ok) remembered = { key, until: now() + REMEMBER_MS, endpoint: resolved };
      return resolved;
    });
    const mine = { key, promise };
    pending = mine;
    try {
      return await promise;
    } finally {
      if (pending === mine) pending = undefined;
    }
  }

  return {
    resolve,
    forget() {
      remembered = undefined;
    },
  };
}

const shared = createEndpointResolver();

/** The address to use now (see `createEndpointResolver`), shared by everything in this process. */
export const resolveEndpoint = shared.resolve;
export const forgetEndpoint = shared.forget;
