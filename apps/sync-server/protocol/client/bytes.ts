import { randomBytes } from "node:crypto";

/** Opaque payload bytes. There is no crypto here: random bytes stand in for ciphertext, which the server never reads. */
export function randomPayload(size: number): Uint8Array {
  return new Uint8Array(randomBytes(size));
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export const newUuid = () => randomHex(16);
export const newBatchId = () => `b_${randomHex(10)}`;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
