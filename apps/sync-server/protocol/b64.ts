// Base64 for payloads. Records are opaque bytes; the wire carries them as standard (padded) base64.

/** Returns the standard base64 text of `bytes`. */
export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** Returns null when the string is not canonical standard base64. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const buf = Buffer.from(text, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
