// Edit ids ride in the first bytes of a payload so a scenario can tell which edit it is looking at.
// The rest is random: the server sees only opaque bytes either way.

import { randomPayload } from "../client/bytes.ts";

export function makePayload(editId: number, size: number, rng: () => number): Uint8Array {
  const p = randomPayload(Math.max(size, 8), rng);
  new DataView(p.buffer, p.byteOffset).setUint32(0, editId, false);
  return p;
}

export function editIdOf(payload: Uint8Array): number {
  return payload.length >= 4 ? new DataView(payload.buffer, payload.byteOffset).getUint32(0, false) : -1;
}
