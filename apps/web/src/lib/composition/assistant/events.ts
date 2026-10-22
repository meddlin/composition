import type { ChatErrorKind, ChatEvent } from "./types";

const KINDS: readonly string[] = [
  "unreachable", "model-missing", "auth", "server", "aborted", "bad-response", "refused", "invalid-request",
] satisfies ChatErrorKind[];

/** Whether the event ends a turn: nothing follows `done` or `error`. */
export const endsTurn = (event: ChatEvent): boolean => event.type === "done" || event.type === "error";

/** A line of the route's stream as an event, or undefined when it is not one. */
export function parseChatEvent(value: unknown): ChatEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const e = value as Record<string, unknown>;
  switch (e.type) {
    case "delta":
      return typeof e.text === "string" ? { type: "delta", text: e.text } : undefined;
    case "thinking":
      return { type: "thinking" };
    case "usage":
      return {
        type: "usage",
        ...(typeof e.promptTokens === "number" && { promptTokens: e.promptTokens }),
        ...(typeof e.outputTokens === "number" && { outputTokens: e.outputTokens }),
      };
    case "done":
      return { type: "done" };
    case "error":
      return typeof e.message === "string" && typeof e.kind === "string" && KINDS.includes(e.kind)
        ? { type: "error", kind: e.kind as ChatErrorKind, message: e.message }
        : undefined;
    default:
      return undefined;
  }
}
