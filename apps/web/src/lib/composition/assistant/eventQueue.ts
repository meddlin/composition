/**
 * A queue that turns values pushed from callbacks (events from the desktop main process) into something a
 * `for await` can read. Values pushed before anyone reads are kept; `close()` ends the reading once what was
 * pushed has been read; a reader that stops early closes it too.
 */
export type EventQueue<T> = AsyncIterable<T> & { push(value: T): void; close(): void };

export function createEventQueue<T>(): EventQueue<T> {
  const waiting: T[] = [];
  let wake: (() => void) | undefined;
  let closed = false;

  const notify = () => {
    wake?.();
    wake = undefined;
  };

  return {
    push(value) {
      if (closed) return;
      waiting.push(value);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *[Symbol.asyncIterator]() {
      try {
        for (;;) {
          if (waiting.length > 0) yield waiting.shift() as T;
          else if (closed) return;
          else await new Promise<void>((resolve) => (wake = resolve));
        }
      } finally {
        closed = true;
        waiting.length = 0;
      }
    },
  };
}
