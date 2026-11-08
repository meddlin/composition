// Change hints: "something moved, go pull". A hint carries no data, so a missed one costs one poll interval.
// The server advertises its mechanism in /v1/info (a client adapts to a server, never assumes it); today that is
// `sse`: GET /v1/events, a text/event-stream.

import type { Hint, InfoResponse } from "../types.ts";
import { sleep } from "./bytes.ts";

export interface HintSource {
  /** Resolves once the stream is connected and has delivered its first hint. */
  ready: Promise<void>;
  close(): void;
}

export type HintHandler = (hint: Hint | undefined) => void;

export function sseHints(baseUrl: string, path: string, token: string, onHint: HintHandler): HintSource {
  const abort = new AbortController();
  let markReady: () => void = () => {};
  const ready = new Promise<void>((r) => (markReady = r));

  (async () => {
    let backoff = 200;
    while (!abort.signal.aborted) {
      try {
        const res = await fetch(baseUrl.replace(/\/$/, "") + path, {
          headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`events HTTP ${res.status}`);
        backoff = 200;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame.split("\n").find((l) => l.startsWith("data: "));
            if (frame.includes("event: hint") && data) {
              markReady();
              onHint(JSON.parse(data.slice(6)) as Hint);
            }
          }
        }
      } catch {
        if (abort.signal.aborted) return;
      }
      // The stream ended or failed. Reconnect, and tell the device to pull in case it missed a hint.
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 5000);
      onHint(undefined);
    }
  })();

  return { ready, close: () => abort.abort() };
}

/** Open the hint stream the server advertises. */
export async function openHints(baseUrl: string, info: InfoResponse, token: string, onHint: HintHandler): Promise<HintSource> {
  return sseHints(baseUrl, info.hint.path, token, onHint);
}
