import { describe, expect, it } from "vitest";
import { readSse, SseError } from "./sse";

const encoder = new TextEncoder();

function bodyOf(...pieces: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of readSse(body)) events.push(event);
  return events;
}

describe("readSse", () => {
  it("yields each event with its name and parsed data", async () => {
    const events = await collect(bodyOf('event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n'));
    expect(events).toEqual([
      { event: "a", data: { x: 1 } },
      { event: "b", data: { y: 2 } },
    ]);
  });

  it("joins an event that arrives in pieces, including a CRLF cut between chunks", async () => {
    const events = await collect(bodyOf('event: a\r', '\ndata: {"x"', ":1}\r\n\r", "\n"));
    expect(events).toEqual([{ event: "a", data: { x: 1 } }]);
  });

  it("skips comments, events with no data, and a final [DONE]", async () => {
    expect(await collect(bodyOf(': keep-alive\n\nevent: ping\n\ndata: {"a":1}\n\ndata: [DONE]\n\n'))).toEqual([
      { event: undefined, data: { a: 1 } },
    ]);
  });

  it("reads a last event that has no blank line after it", async () => {
    expect(await collect(bodyOf('data: {"a":1}'))).toEqual([{ event: undefined, data: { a: 1 } }]);
  });

  it("fails on data that is not JSON, after yielding what came before", async () => {
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const event of readSse(bodyOf('data: {"a":1}\n\ndata: nope\n\n'))) seen.push(event.data);
      })(),
    ).rejects.toBeInstanceOf(SseError);
    expect(seen).toEqual([{ a: 1 }]);
  });
});
