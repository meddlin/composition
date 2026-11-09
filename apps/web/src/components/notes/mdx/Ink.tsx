import { useEffect, useMemo, useState } from "react";
import { INK_DENSITY, type InkDrawing } from "@/lib/composition/ink";
import { loadInkDrawing } from "@/lib/composition/inkDrawings";
import { imageNameFromRef } from "@/lib/composition/imageRefs";
import { inkPicture } from "@/lib/composition/inkSvg";
import { NoteImage } from "../NoteImage";
import { imageWidthCss } from "./imageWidth";

/**
 * A drawing made with the Pencil on the iPad, written in a note as `<Ink src="app_data/…" alt="…" width="80%" />`
 * (docs/architecture/ink.md). It is stored as a PNG that carries its own strokes: an ordinary image to everything else
 * (backups, the Images page, the terminal app), and here drawn **from the strokes** as an SVG made at render time, in the
 * colour scheme in force, so black ink is white on a dark scheme. View only: drawing and editing are the iPad's.
 *
 * A PNG that carries no strokes, or whose strokes can't be read (damaged, or from a newer version), is shown as the
 * picture it is. `width` is as for `<Image>`; see imageWidth.ts.
 */
export function Ink({ src, alt, title, width }: { src?: string; alt?: string; title?: string; width?: string }) {
  if (!src) return <span className="text-muted-foreground italic">Drawing: add a src</span>;
  const name = imageNameFromRef(src);
  const css = imageWidthCss(width);

  return (
    // The box takes the width, as for <Drawio>; Typography's own margin on images would push the picture off its box.
    <span className="my-4 inline-block max-w-full align-top [&_img]:my-0" style={{ width: css }}>
      {name ? <StoredInk name={name} src={src} alt={alt} title={title} width={css} /> : <Picture src={src} alt={alt} title={title} width={css} />}
    </span>
  );
}

/** Just the picture: a drawing from a web address has no strokes to read, and the pixels are drawn at the size of the canvas they came from. */
function Picture({ src, alt, title, width }: { src: string; alt?: string; title?: string; width?: string }) {
  return <NoteImage src={src} alt={alt} title={title} width={width ? "100%" : undefined} density={INK_DENSITY} />;
}

function StoredInk({ name, src, alt, title, width }: { name: string; src: string; alt?: string; title?: string; width?: string }) {
  const drawing = useInkDrawing(name);
  if (drawing === undefined) return <span className="text-muted-foreground italic">Drawing…</span>;
  if (drawing === null) return <Picture src={src} alt={alt} title={title} width={width} />;
  return <InkSvg drawing={drawing} alt={alt} title={title} width={width} />;
}

/** The drawing a stored PNG carries: undefined while it loads, null when the PNG is only a picture (or can't be fetched, which the picture then reports). */
function useInkDrawing(name: string): InkDrawing | null | undefined {
  const [result, setResult] = useState<{ name: string; drawing: InkDrawing | null } | null>(null);
  useEffect(() => {
    let current = true;
    loadInkDrawing(name).then(
      (drawing) => current && setResult({ name, drawing }),
      () => current && setResult({ name, drawing: null }),
    );
    return () => {
      current = false;
    };
  }, [name]);
  return result?.name === name ? result.drawing : undefined;
}

/** The drawing as an SVG, in the page's own colours (`--foreground` for ink, `--brand` for accent), drawn as large as its canvas unless the note says. */
export function InkSvg({ drawing, alt, title, width }: { drawing: InkDrawing; alt?: string; title?: string; width?: string }) {
  const picture = useMemo(() => inkPicture(drawing), [drawing]);
  return (
    <svg
      viewBox={`0 0 ${picture.width} ${picture.height}`}
      role="img"
      aria-label={alt ?? ""}
      className="block h-auto max-w-full"
      style={{ width: width ? "100%" : `${picture.width}px` }}
      data-ink=""
    >
      {title && <title>{title}</title>}
      {picture.shapes.map((shape, index) => (
        <path key={index} d={shape.d} fillOpacity={shape.opacity} style={{ fill: shape.fill }} />
      ))}
    </svg>
  );
}
