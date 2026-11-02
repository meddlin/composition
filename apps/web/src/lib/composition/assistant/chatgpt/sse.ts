/** A block of the stream was not a server-sent event with JSON data. */
export class SseError extends Error {}

export type SseEvent = { event: string | undefined; data: unknown };

function parseBlock(block: string): SseEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return undefined;
  const joined = data.join("\n");
  if (joined.trim() === "[DONE]") return undefined;
  try {
    return { event, data: JSON.parse(joined) };
  } catch {
    throw new SseError(`Not JSON: ${joined.slice(0, 200)}`);
  }
}

/**
 * Reads a body of server-sent events and yields each event with its data parsed, as it completes. Events end at
 * a blank line, may arrive in pieces, and may use CRLF; comments and events with no data are skipped, and so is
 * a final `[DONE]`. A block whose data is not JSON ends the stream with an `SseError`, after everything before it
 * has been yielded.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let pending = "";
  const take = function* (final: boolean) {
    pending = pending.replace(/\r\n/g, "\n");
    let end = pending.indexOf("\n\n");
    while (end >= 0) {
      const parsed = parseBlock(pending.slice(0, end));
      pending = pending.slice(end + 2);
      if (parsed) yield parsed;
      end = pending.indexOf("\n\n");
    }
    if (final && pending.trim() !== "") {
      const parsed = parseBlock(pending);
      pending = "";
      if (parsed) yield parsed;
    }
  };
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    yield* take(false);
  }
  pending += decoder.decode();
  yield* take(true);
}
