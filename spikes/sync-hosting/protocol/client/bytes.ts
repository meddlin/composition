import { createHash } from "node:crypto";

/** Small deterministic PRNG so a scenario or fault plan can be replayed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Opaque payload bytes. There is no crypto here (spike S5 covers encryption): random bytes stand in for ciphertext. */
export function randomPayload(size: number, rng: () => number = Math.random): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 4) {
    const r = Math.floor(rng() * 4294967296);
    out[i] = r & 255;
    if (i + 1 < size) out[i + 1] = (r >>> 8) & 255;
    if (i + 2 < size) out[i + 2] = (r >>> 16) & 255;
    if (i + 3 < size) out[i + 3] = (r >>> 24) & 255;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const newUuid = () => randomHex(16);
export const newBatchId = () => `b_${randomHex(10)}`;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}
