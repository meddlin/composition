import { WidgetType, type EditorView } from "@codemirror/view";
import { imageNameFromRef } from "@/lib/composition/imageRefs";
import type { InkDrawing } from "@/lib/composition/ink";
import { loadInkDrawing } from "@/lib/composition/inkDrawings";
import { inkPicture } from "@/lib/composition/inkSvg";
import { ImageWidget, type NoteImageSpec } from "./liveImages";
import { imageWidthCss } from "./mdx/imageWidth";

const SVG = "http://www.w3.org/2000/svg";

/**
 * An `<Ink … />` drawn in the text, as the preview's `<Ink>` draws it (docs/architecture/ink.md): from the strokes the
 * stored PNG carries, as an SVG in the page's colours, so black ink is white on a dark scheme. View only. A drawing
 * that can't be read as strokes (or isn't a stored one, or can't be fetched) is drawn as the picture, by `ImageWidget`,
 * which also says when the file is gone. `beside` is as for `ImageWidget`: the caret is in the tag's own text.
 */
export class InkWidget extends WidgetType {
  constructor(
    readonly spec: NoteImageSpec,
    readonly beside: boolean,
  ) {
    super();
  }

  eq(other: InkWidget) {
    const { src, alt, title, width } = this.spec;
    return this.beside === other.beside && src === other.spec.src && alt === other.spec.alt && title === other.spec.title && width === other.spec.width;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-live-image";

    const picture = () => {
      wrap.replaceChildren(new ImageWidget(this.spec, this.beside).toDOM(view));
      view.requestMeasure();
    };
    const name = imageNameFromRef(this.spec.src);
    if (!name) {
      picture();
      return wrap;
    }

    loadInkDrawing(name).then(
      (drawing) => {
        if (drawing) {
          // The box takes the width, as in the preview (a share of the note's width, not of the drawing's own), and the drawing fills it.
          wrap.style.width = imageWidthCss(this.spec.width) ?? "";
          wrap.replaceChildren(inkSvg(drawing, this.spec));
        } else {
          picture();
        }
        // The drawing arrives after the line was measured; the editor has to measure again to place what is below it.
        view.requestMeasure();
      },
      picture,
    );
    return wrap;
  }

  /** Clicks and drags go to the editor, which puts the caret at the drawing (and so shows its tag). */
  ignoreEvent() {
    return false;
  }
}

/** The drawing as an SVG element, drawn as large as its canvas unless the tag gives a width (then it fills its box). */
function inkSvg(drawing: InkDrawing, { alt, title, width }: NoteImageSpec): SVGElement {
  const picture = inkPicture(drawing);
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${picture.width} ${picture.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", alt);
  svg.style.width = imageWidthCss(width) ? "100%" : `${picture.width}px`;
  if (title) {
    const tooltip = document.createElementNS(SVG, "title");
    tooltip.textContent = title;
    svg.append(tooltip);
  }
  for (const shape of picture.shapes) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", shape.d);
    path.setAttribute("fill-opacity", String(shape.opacity));
    path.style.fill = shape.fill;
    svg.append(path);
  }
  return svg;
}
