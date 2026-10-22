import { streamAssistantChat } from "@/lib/composition/assistantService";
import { checkChatRequest } from "@/lib/composition/assistant/chatRequest";
import { assistantRefusal } from "@/lib/composition/uploadGuard";

export const dynamic = "force-dynamic";

/** Bytes. Far above any note and conversation (the text itself is capped at about 2 MB of characters). */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const json = (body: unknown, status: number) => Response.json(body, { status });

/**
 * One turn of the AI helper's chat: `POST` a model, the messages and a context size, and get the reply back as it
 * is produced, one JSON `ChatEvent` per line. This is a route handler and not a Server Action because Server
 * Actions run one at a time per client, so a stream lasting minutes would hold back the note's autosave.
 *
 * Which server it talks to is the saved setting, never anything in the request. The same-origin guard is the
 * one the attachment upload uses: a route handler has no cross-site protection of its own, and this one sends
 * the user's notes somewhere. Problems with the request are a 4xx with `{ error }`; anything that goes wrong
 * once the turn has started (the server is down, the model is missing) is an `error` event in the stream.
 *
 * The desktop build has no routes like this: its main process makes the call (see main/assistant.ts).
 */
export async function POST(request: Request) {
  const refusal = assistantRefusal(request.headers);
  if (refusal) return json({ error: refusal }, 403);

  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return json({ error: "The conversation is too large to send." }, 413);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "The request body is not JSON." }, 400);
  }
  const checked = checkChatRequest(payload);
  if (!checked.ok) return json({ error: checked.error }, 400);

  // A client that goes away aborts `request.signal`, which stops the request to Ollama (and so its generating).
  const events = streamAssistantChat(checked.request, request.signal);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
