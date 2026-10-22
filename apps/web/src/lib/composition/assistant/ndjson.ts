/** A line of the stream was not JSON. The message quotes the start of it. */
export class NdjsonError extends Error {}

const QUOTED_LINE_LENGTH = 200;

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    const quoted = line.trim().slice(0, QUOTED_LINE_LENGTH);
    throw new NdjsonError(`Not JSON: ${quoted}`);
  }
}

/**
 * Reads a body of newline-delimited JSON and yields each line's value as it completes. Lines can arrive in
 * pieces, a multi-byte character can be cut between chunks, the last line may have no newline, and blank
 * lines (and CRLF endings) are ignored. A line that is not JSON ends the stream with an `NdjsonError`, after
 * everything before it has been yielded.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") yield parseLine(line);
    }
  }
  pending += decoder.decode();
  if (pending.trim() !== "") yield parseLine(pending);
}
