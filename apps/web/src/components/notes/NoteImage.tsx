import { useState, type ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { imageNameFromRef } from "@/lib/composition/imageRefs";
import { imageUrl } from "@/lib/composition/imageUrl";
import { imageWidthCss } from "./mdx/imageWidth";

/**
 * The preview's rendering of Markdown image syntax, `![alt](src)`. Wired in
 * through react-markdown's `components` map (see `markdownComponents`).
 *
 * An `app_data/<name>` path is an image pasted into a note and is fetched from
 * wherever this build serves them; any other source (an https URL, a data: URI)
 * is shown as written. A file that has gone missing shows its alt text instead
 * of the browser's broken-image icon.
 *
 * `density` says the picture has that many pixels per CSS pixel (a diagram is stored at 2x, so its text stays
 * sharp); without a `width` it is drawn at its own size divided by that, rather than twice as large as drawn.
 *
 * `width` (from `<Image width="50%" />`; Markdown's syntax has no way to say it) draws the image
 * smaller or larger than its own size, but never wider than the note. See imageWidth.ts.
 */
export function NoteImage({
  src,
  alt,
  title,
  width,
  density,
}: ComponentPropsWithoutRef<"img"> & ExtraProps & { density?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  if (typeof src !== "string" || src === "") return null;

  const name = imageNameFromRef(src);
  const resolved = name ? imageUrl(name) : src;

  if (failedSrc === resolved) {
    return (
      <span role="img" aria-label={alt ?? ""} className="text-muted-foreground italic">
        {`Image not found: ${alt || name || src}`}
      </span>
    );
  }

  return (
    // A plain <img>: next/image can't optimize files that live outside the build, and the desktop export is unoptimized.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt ?? ""}
      title={title}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(resolved)}
      onLoad={(event) => density && setNaturalWidth(event.currentTarget.naturalWidth)}
      style={{ width: imageWidthCss(width) ?? (density && naturalWidth ? `${naturalWidth / density}px` : undefined) }}
      className="h-auto max-w-full"
    />
  );
}

export const markdownComponents = { img: NoteImage };
