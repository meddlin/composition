import { useState, type ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { imageNameFromRef } from "@/lib/composition/imageRefs";
import { imageUrl } from "@/lib/composition/imageUrl";

/**
 * The preview's rendering of Markdown image syntax, `![alt](src)`. Wired in
 * through react-markdown's `components` map (see `markdownComponents`).
 *
 * An `app_data/<name>` path is an image pasted into a note and is fetched from
 * wherever this build serves them; any other source (an https URL, a data: URI)
 * is shown as written. A file that has gone missing shows its alt text instead
 * of the browser's broken-image icon.
 */
export function NoteImage({ src, alt, title }: ComponentPropsWithoutRef<"img"> & ExtraProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
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
      className="h-auto max-w-full"
    />
  );
}

export const markdownComponents = { img: NoteImage };
