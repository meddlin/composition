import { isCloudModelName } from "./models";
import { MAX_CONTEXT_TOKENS, MIN_CONTEXT_TOKENS } from "./settings";
import type { ChatMessage, ChatRequest, ChatRole } from "./types";

/** The most text one request may carry, in characters, across all its messages. About 2 MB: far more than a note. */
export const MAX_REQUEST_CHARS = 2_000_000;
const MAX_MODEL_NAME = 200;
const MAX_MESSAGES = 500;
const ROLES: readonly ChatRole[] = ["system", "user", "assistant"];

export type CheckedChatRequest = { ok: true; request: ChatRequest } | { ok: false; error: string };

const refuse = (error: string): CheckedChatRequest => ({ ok: false, error });

/**
 * Checks a chat request that came from a page, which is untrusted input, and returns only the fields it expects.
 * Used by the web route and the desktop IPC handler alike. A cloud model is refused by name: the server would
 * forward it to ollama.com, which is not the server the user chose.
 */
export function checkChatRequest(input: unknown): CheckedChatRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return refuse("The request is not an object.");
  const { model, messages, numCtx } = input as Record<string, unknown>;

  if (typeof model !== "string" || model === "" || model.length > MAX_MODEL_NAME) return refuse("The model name is missing or invalid.");
  if (isCloudModelName(model)) {
    return refuse(`"${model}" runs on ollama.com, not on your server, so the AI helper does not use it.`);
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return refuse("The conversation is empty or has too many messages.");
  }
  if (typeof numCtx !== "number" || !Number.isInteger(numCtx) || numCtx < MIN_CONTEXT_TOKENS || numCtx > MAX_CONTEXT_TOKENS) {
    return refuse("The context size is invalid.");
  }

  const checked: ChatMessage[] = [];
  let characters = 0;
  for (const entry of messages) {
    if (typeof entry !== "object" || entry === null) return refuse("A message is not an object.");
    const { role, content } = entry as Record<string, unknown>;
    if (typeof role !== "string" || !ROLES.includes(role as ChatRole) || typeof content !== "string") {
      return refuse("A message has an unknown role or no text.");
    }
    characters += content.length;
    if (characters > MAX_REQUEST_CHARS) return refuse("The conversation is too large to send.");
    checked.push({ role: role as ChatRole, content });
  }
  return { ok: true, request: { model, messages: checked, numCtx } };
}
