import type { ImageInfo } from "@/lib/composition/api";

/** How many images the picker lists at once; narrowing by typing finds the rest. */
export const MAX_PICKER_IMAGES = 50;

/**
 * The images the picker offers for what was typed, in the order given (newest
 * first). Every word has to appear in the file name, which starts with the title
 * of the note the image was pasted into, so `trip map` finds `trip-plan-route-map-…`.
 */
export function matchImages(images: readonly ImageInfo[], query: string, limit = MAX_PICKER_IMAGES): ImageInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = images.filter(({ name }) => words.every((word) => name.toLowerCase().includes(word)));
  return hits.slice(0, limit);
}

/** "Not used in any note", or how many notes still point at the image. */
export function usageLabel(image: Pick<ImageInfo, "usedIn">): string {
  const count = image.usedIn.length;
  if (count === 0) return "Not used in any note";
  return count === 1 ? "Used in 1 note" : `Used in ${count} notes`;
}

/** A file size the way a person reads it: `812 KB`, `2.4 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
