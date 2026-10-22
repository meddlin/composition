import { failureFromResponse, failureFromThrown, notOllama, type Failure } from "./errors";
import { NdjsonError, readNdjson } from "./ndjson";
import type { ChatEvent, ChatProvider, ChatRequest } from "./types";

type StreamLine = {
  error?: unknown;
  message?: { content?: unknown; thinking?: unknown };
  done?: unknown;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
};

const failed = (failure: Failure): ChatEvent => ({ type: "error", ...failure });

/**
 * One chat turn against Ollama's native `POST /api/chat`: yields the answer as it streams, then the token counts
 * and `done`. Every failure comes back as an `error` event, and nothing is thrown. Sends no `think` option (a
 * model that can think does so by default, and one that cannot would refuse it), no credentials, and never an
 * empty conversation (the server would only load the model).
 */
export async function* streamChat(
  baseUrl: string,
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  if (request.messages.length === 0) {
    yield failed({ kind: "invalid-request", message: "There is nothing to send: the conversation is empty." });
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        options: { num_ctx: request.numCtx },
      }),
      signal,
    });
  } catch (error) {
    yield failed(failureFromThrown(error, baseUrl));
    return;
  }

  // A refusal before any streaming is an HTTP error with a JSON body, not a line of the stream.
  if (!response.ok) {
    yield failed(await failureFromResponse(response, baseUrl, request.model));
    return;
  }
  if (response.body === null) {
    yield failed(notOllama(baseUrl));
    return;
  }

  try {
    let thinking = false;
    let finished = false;
    for await (const value of readNdjson(response.body)) {
      const line = value as StreamLine;
      // Once bytes have gone out the status can no longer change, so a failure is a line of its own.
      if (typeof line.error === "string") {
        yield failed({ kind: "server", message: `Ollama said: ${line.error}` });
        return;
      }
      const reasoning = line.message?.thinking;
      if (typeof reasoning === "string" && reasoning !== "" && !thinking) {
        thinking = true;
        yield { type: "thinking" };
      }
      const text = line.message?.content;
      if (typeof text === "string" && text !== "") {
        thinking = false;
        yield { type: "delta", text };
      }
      if (line.done === true) {
        finished = true;
        const usage = usageOf(line);
        if (usage !== undefined) yield usage;
        yield { type: "done" };
      }
    }
    if (!finished) {
      yield failed({ kind: "unreachable", message: `The connection to ${baseUrl} closed before the answer was finished.` });
    }
  } catch (error) {
    yield failed(error instanceof NdjsonError ? notOllama(baseUrl) : failureFromThrown(error, baseUrl));
  }
}

function usageOf(line: StreamLine): ChatEvent | undefined {
  const promptTokens = typeof line.prompt_eval_count === "number" ? line.prompt_eval_count : undefined;
  const outputTokens = typeof line.eval_count === "number" ? line.eval_count : undefined;
  if (promptTokens === undefined && outputTokens === undefined) return undefined;
  return {
    type: "usage",
    ...(promptTokens !== undefined && { promptTokens }),
    ...(outputTokens !== undefined && { outputTokens }),
  };
}

/** Ollama as a `ChatProvider`, the seam other servers will plug into. */
export const ollama: ChatProvider = { streamChat };
