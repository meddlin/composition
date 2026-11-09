import { WidgetType, type EditorView } from "@codemirror/view";
import { imageNameFromRef } from "@/lib/composition/imageRefs";
import { imageUrl } from "@/lib/composition/imageUrl";
import type { Segment } from "./markdownTokens";
import { literalFinder } from "./markTints";
import { imageWidthCss } from "./mdx/imageWidth";

/** A picture a note shows: what the preview would draw for `![alt](src)` or `<Image src="…" alt="…" />`. */
export type NoteImageSpec = { src: string; alt: string; title: string; width: string };

/** An `<Image … />` as the text writes it, and where. */
export type ImageElement = NoteImageSpec & { start: number; end: number };

// `matchAll` works on a copy, so these shared patterns keep no position between calls.
const TAGS = { Image: /<Image\b[^<>]*\/>/g, Ink: /<Ink\b[^<>]*\/>/g };
const PROP = /\b([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\})/g;

/** The props an `<Image>` tag writes as quoted text (`src`, `alt`, `title`, `width`); others are not its to draw. */
function imageProps(tag: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [, name, double, single, braced] of tag.matchAll(PROP)) props[name] = double ?? single ?? braced;
  return props;
}

/**
 * Each complete `<Image … />`, outside code and frontmatter, in the order they appear. A tag with no `src` (one
 * still being typed) is skipped, so there is nothing to draw until it says what to draw. `name` is another tag
 * that takes the same props and is drawn the same way, `Ink`.
 */
export function imageElements(text: string, segments: Segment[], name: "Image" | "Ink" = "Image"): ImageElement[] {
  if (!text.includes(`<${name}`)) return [];

  const inLiteral = literalFinder(segments);
  const elements: ImageElement[] = [];
  for (const tag of text.matchAll(TAGS[name])) {
    if (inLiteral(tag.index)) continue;
    const { src, alt, title, width } = imageProps(tag[0]);
    if (!src) continue;
    elements.push({ start: tag.index, end: tag.index + tag[0].length, src, alt: alt ?? "", title: title ?? "", width: width ?? "" });
  }
  return elements;
}

/**
 * The address of a Markdown image (`(app_data/x.png "title")`, as the syntax tree gives its parts): the text of
 * the URL node, without the angle brackets that let it hold spaces.
 */
export function markdownImageSrc(url: string): string {
  return url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
}

/** A Markdown image's title: the text of its title node, without the quotes (or parentheses) around it. */
export function markdownImageTitle(raw: string): string {
  return raw.length >= 2 ? raw.slice(1, -1) : "";
}

/**
 * A picture drawn in the text. Like the preview's `NoteImage`, a stored image (`app_data/…`) is fetched from
 * wherever this build serves them and any other source is used as written, and a file that is gone shows its
 * alt text where the picture would be. `beside` is a picture drawn *next to* the Markdown that makes it (the caret
 * is in that Markdown): there, one that can't be shown is left out rather than reported, since it may be half typed.
 */
export class ImageWidget extends WidgetType {
  constructor(
    readonly spec: NoteImageSpec,
    readonly beside: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    const { src, alt, title, width } = this.spec;
    return this.beside === other.beside && src === other.spec.src && alt === other.spec.alt && title === other.spec.title && width === other.spec.width;
  }

  toDOM(view: EditorView) {
    const { src, alt, title, width } = this.spec;
    const name = imageNameFromRef(src);

    const wrap = document.createElement("span");
    wrap.className = "cm-live-image";

    const image = document.createElement("img");
    image.src = name ? imageUrl(name) : src;
    image.alt = alt;
    if (title) image.title = title;
    image.decoding = "async";
    const css = imageWidthCss(width);
    if (css) image.style.width = css;
    // The picture arrives after the line was measured; the editor has to measure again to place what is below it.
    image.addEventListener("load", () => view.requestMeasure());
    image.addEventListener("error", () => {
      if (this.beside) {
        wrap.remove();
      } else {
        const missing = document.createElement("span");
        missing.className = "cm-live-image-missing";
        missing.setAttribute("role", "img");
        missing.setAttribute("aria-label", alt);
        missing.textContent = `Image not found: ${alt || name || src}`;
        wrap.replaceChildren(missing);
      }
      view.requestMeasure();
    });
    wrap.append(image);
    return wrap;
  }

  /** Clicks and drags go to the editor, which puts the caret at the picture (and so shows its Markdown). */
  ignoreEvent() {
    return false;
  }
}
