/**
 * The origin of a URL string, or null if it has none we can trust.
 *
 * Not `new URL(url).origin`: in Node, only "special" schemes (http, https, ...)
 * have an origin, so `app://composition/` would come back as the string "null"
 * and never match anything. For any other scheme with a host we build it
 * ourselves, so `app://composition/x` is `app://composition` and a lookalike
 * such as `app://composition.evil.example/` is not.
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "null") return parsed.origin;
    return parsed.host ? `${parsed.protocol}//${parsed.host}` : null;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(url: string, allowedOrigins: readonly string[]): boolean {
  const origin = originOf(url);
  return origin !== null && allowedOrigins.includes(origin);
}
