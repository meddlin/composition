import { describe, expect, it } from "vitest";
import { createEventQueue } from "./eventQueue";

const drain = async <T,>(queue: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const value of queue) out.push(value);
  return out;
};

describe("createEventQueue", () => {
  it("yields what was pushed before anyone was reading, then ends when closed", async () => {
    const queue = createEventQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.close();
    expect(await drain(queue)).toEqual([1, 2]);
  });

  it("waits for values that have not arrived yet", async () => {
    const queue = createEventQueue<string>();
    const reading = drain(queue);
    setTimeout(() => {
      queue.push("a");
      queue.push("b");
      queue.close();
    }, 5);
    expect(await reading).toEqual(["a", "b"]);
  });

  it("ignores anything pushed after it was closed", async () => {
    const queue = createEventQueue<number>();
    queue.push(1);
    queue.close();
    queue.push(2);
    expect(await drain(queue)).toEqual([1]);
  });

  it("ends a reader that gives up early, without needing a close", async () => {
    const queue = createEventQueue<number>();
    queue.push(1);
    queue.push(2);
    for await (const value of queue) {
      expect(value).toBe(1);
      break;
    }
    expect(await queue[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
  });
});
