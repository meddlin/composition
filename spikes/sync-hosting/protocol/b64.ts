// Base64 for payloads. Uses Buffer where it exists (Node) and a table-driven fallback where it does not
// (the Convex default runtime has no Buffer).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

// Typed structurally so this file compiles where Node's types are absent (the Convex functions project).
interface BufferInstance {
  buffer: ArrayBufferLike;
  byteOffset: number;
  byteLength: number;
  toString(encoding: string): string;
}
const nodeBuffer = (globalThis as { Buffer?: { from(...args: unknown[]): BufferInstance } }).Buffer;

export function encodeBase64(bytes: Uint8Array): string {
  if (nodeBuffer) return nodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out.push(ALPHABET[b0 >> 2]!);
    out.push(ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!);
    out.push(b1 === undefined ? "=" : ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!);
    out.push(b2 === undefined ? "=" : ALPHABET[b2 & 63]!);
  }
  return out.join("");
}

/** Returns null when the string is not canonical standard base64. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  if (nodeBuffer) {
    const buf = nodeBuffer.from(text, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const c0 = LOOKUP[text.charCodeAt(i)]!;
    const c1 = LOOKUP[text.charCodeAt(i + 1)]!;
    const c2 = text[i + 2] === "=" ? 0 : LOOKUP[text.charCodeAt(i + 2)]!;
    const c3 = text[i + 3] === "=" ? 0 : LOOKUP[text.charCodeAt(i + 3)]!;
    if (o < out.length) out[o++] = (c0 << 2) | (c1 >> 4);
    if (o < out.length) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (o < out.length) out[o++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}
