import { NoteImage } from "../NoteImage";

/**
 * An image, written in a note as `<Image src="app_data/…" alt="…" />`. It is
 * the same thing as Markdown's `![alt](src)` (pasting inserts that form), and
 * resolves `src` the same way; see NoteImage.
 *
 * Unlike Markdown's form it can say how wide to draw the image: `width="400"` (pixels) or
 * `width="50%"` (of the note's width). See imageWidth.ts.
 */
export function Image({ src, alt, title, width }: { src?: string; alt?: string; title?: string; width?: string }) {
  return <NoteImage src={src} alt={alt} title={title} width={width} />;
}
