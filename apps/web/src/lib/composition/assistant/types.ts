/**
 * What the AI helper's provider layer speaks. Types only, so it is safe to import anywhere (renderer,
 * route handler, Electron main). The design is docs/ai-helper-plan.md.
 */

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export type ChatRequest = {
  model: string;
  /** Never empty: Ollama answers an empty list by only loading the model. */
  messages: ChatMessage[];
  /** The context window to ask the server for, in tokens. Sent every time: the server's own default is small. */
  numCtx: number;
};

/** Why a turn failed, in terms the UI can act on. */
export type ChatErrorKind =
  /** Nothing answered at that address (not running, wrong address, a blocked port, no network). */
  | "unreachable"
  /** The server is up but the model is not installed there. */
  | "model-missing"
  /** The server wants credentials, which this version does not send. */
  | "auth"
  /** The server answered with an error of its own (also an error line in the middle of a stream). */
  | "server"
  /** The caller stopped the turn. */
  | "aborted"
  /** The server answered, but not with anything this code understands. */
  | "bad-response"
  /** The helper will not do it: not a request from the app itself, or a model that runs somewhere other than the chosen server. */
  | "refused"
  /** The request itself was wrong (a bug in the caller), so nothing was sent. */
  | "invalid-request";

export type ChatEvent =
  /** A piece of the answer. */
  | { type: "delta"; text: string }
  /** The model is reasoning. Its text is deliberately not passed on. */
  | { type: "thinking" }
  /** Token counts for the turn, sent once, just before `done`. */
  | { type: "usage"; promptTokens?: number; outputTokens?: number }
  | { type: "done" }
  | { type: "error"; kind: ChatErrorKind; message: string };

/** One chat server. Failures arrive as an `error` event, never as a throw. */
export interface ChatProvider {
  streamChat(baseUrl: string, request: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatEvent>;
}
