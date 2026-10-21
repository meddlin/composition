/**
 * The `width` of an `<Image>`: how wide it is drawn, never how big the file is. A bare number is
 * pixels (`400`), `%` is a share of the note's width (`50%`), and `px` is allowed for clarity
 * (`400px`). Anything else is ignored, so a half-typed value leaves the image at full size.
 */
export type ImageWidth = { value: number; unit: "px" | "%" };

const WIDTH = /^\s*(\d+(?:\.\d+)?)\s*(px|%)?\s*$/i;

export function parseImageWidth(raw: unknown): ImageWidth | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const match = WIDTH.exec(String(raw));
  if (!match) return null;
  const value = Number(match[1]);
  if (!(value > 0)) return null;
  const unit = match[2] === "%" ? "%" : "px";
  // More than all of the note's width is the same as all of it (the image never overflows its column anyway).
  return { value: unit === "%" ? Math.min(value, 100) : value, unit };
}

/** The CSS width for `raw`, or undefined when it isn't a usable width. */
export function imageWidthCss(raw: unknown): string | undefined {
  const width = parseImageWidth(raw);
  return width ? `${width.value}${width.unit}` : undefined;
}
