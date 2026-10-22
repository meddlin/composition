import { imageNameFromRef } from "@/lib/composition/imageRefs";
import { imageUrl } from "@/lib/composition/imageUrl";

/**
 * Where to fetch a note's header image from: a stored `app_data/<name>` image from this build's own
 * URL, or an `http(s)://` address as written. Anything else (a `data:` URI, a stray word) is not a
 * header image, so a half-typed frontmatter value shows nothing rather than something broken.
 */
export function headerImageSrc(ref: string): string | null {
  const name = imageNameFromRef(ref);
  if (name) return imageUrl(name);
  return /^https?:\/\/\S+$/i.test(ref) ? ref : null;
}

/** The stored image's file name when `ref` is one (what the picker highlights), else null. */
export function headerImageName(ref: string | undefined): string | null {
  return ref ? imageNameFromRef(ref) : null;
}
