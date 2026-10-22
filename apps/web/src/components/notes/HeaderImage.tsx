import { useState } from "react";
import type { HeaderImageLayout } from "@/lib/composition/frontmatter";
import { cn } from "@/lib/utils";
import { headerImageSrc } from "./headerImageSource";

/**
 * The picture above a note's title in the preview. `full` crops it to a banner as wide as the note;
 * `centered` shows the whole picture at its own size (shrunk to fit the note), in the middle.
 * Either way its lower edge fades out into the pane's background, whatever the color scheme, by masking
 * the picture's own alpha rather than painting a color over it. A picture that can't be loaded
 * leaves no gap, so a missing file doesn't push the title down.
 */

// Opaque for the top 45%, then eased out to nothing at the bottom edge.
const FADE = "linear-gradient(to bottom, black 45%, transparent)";
export function HeaderImage({ image, layout }: { image: string; layout: HeaderImageLayout }) {
  const src = headerImageSrc(image);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src === null || failedSrc === src) return null;

  return (
    // A plain <img>, like NoteImage: next/image can't optimize files that live outside the build.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      data-layout={layout}
      decoding="async"
      onError={() => setFailedSrc(src)}
      style={{ maskImage: FADE, WebkitMaskImage: FADE }}
      className={cn(
        "mb-2 block rounded-t-lg",
        layout === "full" ? "h-40 w-full object-cover sm:h-56" : "mx-auto h-auto max-h-72 max-w-full",
      )}
    />
  );
}
