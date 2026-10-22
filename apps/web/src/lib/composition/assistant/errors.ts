import type { ChatErrorKind } from "./types";

/** Why a call to the server failed, in a sentence a person can act on. */
export type Failure = { kind: ChatErrorKind; message: string };

const QUOTED_BODY_LENGTH = 300;

/** What a failed `fetch` threw. Node reports the reason in `error.cause`. */
export function failureFromThrown(error: unknown, baseUrl: string): Failure {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "AbortError") return { kind: "aborted", message: "Stopped." };

  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const code = typeof cause?.code === "string" ? cause.code : "";
  const detail = typeof cause?.message === "string" ? cause.message : "";

  if (/bad port/i.test(detail)) {
    return { kind: "unreachable", message: `Web requests to the port in ${baseUrl} are blocked. Use a different port.` };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { kind: "unreachable", message: `Can't find a computer at ${baseUrl}. Check the address in Settings.` };
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return { kind: "unreachable", message: `Can't reach a computer at ${baseUrl}. Check that it is on and that this computer is on the same network.` };
  }
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return { kind: "unreachable", message: `The connection to ${baseUrl} was dropped. Is Ollama still running?` };
  }
  if (code === "ECONNREFUSED") {
    return { kind: "unreachable", message: `Can't reach Ollama at ${baseUrl}. Is it running?` };
  }
  if (name === "TimeoutError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return { kind: "unreachable", message: `Timed out connecting to ${baseUrl}.` };
  }
  return { kind: "unreachable", message: `Couldn't connect to ${baseUrl}${detail ? ` (${detail})` : ""}.` };
}

/** The answer was not what an Ollama server sends. */
export function notOllama(baseUrl: string): Failure {
  return { kind: "bad-response", message: `The answer from ${baseUrl} isn't what Ollama sends. Is that address an Ollama server?` };
}

/** A non-OK response. Pass `model` for a call about one model, so a 404 can say that it is not installed. */
export async function failureFromResponse(response: Response, baseUrl: string, model?: string): Promise<Failure> {
  const text = (await response.text().catch(() => "")).slice(0, QUOTED_BODY_LENGTH);
  let said: string | undefined;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") said = parsed.error;
  } catch {
    // Not JSON: a proxy's error page, say.
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: "auth", message: "This server asks for credentials, which this version doesn't support." };
  }
  if (response.status === 404) {
    if (model !== undefined && said !== undefined) {
      return { kind: "model-missing", message: `The model "${model}" isn't installed on this server. Install it with: ollama pull ${model}` };
    }
    return notOllama(baseUrl);
  }
  if (said !== undefined) return { kind: "server", message: `Ollama said: ${said}` };
  return { kind: "server", message: `The server at ${baseUrl} answered with an error (${response.status}).` };
}
