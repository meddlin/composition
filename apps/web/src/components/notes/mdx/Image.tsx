import { NoteImage } from "../NoteImage";

/**
 * An image, written in a note as `<Image src="app_data/…" alt="…" />`. It is
 * the same thing as Markdown's `![alt](src)` (pasting inserts that form), and
 * resolves `src` the same way; see NoteImage.
 */
export function Image({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  return <NoteImage src={src} alt={alt} title={title} />;
}
