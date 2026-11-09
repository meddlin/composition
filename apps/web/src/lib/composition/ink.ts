/**
 * The stroke JSON of a drawing (docs/architecture/ink.md): a canvas size and strokes, each a kind of ink, a colour and the
 * points PencilKit sampled, the points' columns named once for the whole drawing. Pure functions and types, so the renderer,
 * the PNG reader and tests can all import it. The Swift core (`CompositionInk`) implements the same rules, pinned by the
 * corpus in `fixtures/conformance/ink/` (status: D9's proposal, until Gate C).
 *
 * Reading is strict about what it needs (a canvas, strokes with finite points, a colour it can read) and keeps the rest:
 * a member of the drawing or of a stroke, or a column of the points, that it doesn't know is carried to the next write
 * (`inkToJSON`). Numbers are written rounded to the format's steps, half away from zero, so the same drawing is the same
 * text on every platform.
 */

export const INK_FORMAT = "composition-ink";
/** The version this code reads and writes. A change a reader would misdraw bumps it; a newer one is refused. */
export const INK_VERSION = 1;

/** A drawing's PNG has this many pixels to a point of its canvas (the iPad stores it at 2x), so drawn at its own size divided by this it is as big as its canvas. */
export const INK_DENSITY = 2;

/** What a drawing may hold: a damaged or hostile file must not use all the memory. */
export const INK_LIMITS = {
  strokes: 100_000,
  points: 5_000_000,
  /** The canvas's width and height. */
  canvas: 100_000,
  /** How far from the origin a point may lie. */
  coordinate: 1_000_000,
  /** The JSON text, before it is parsed. */
  jsonBytes: 256 * 1024 * 1024,
} as const;

/** The columns of a point as the format names them, in the order this code writes them. */
export const INK_FIELDS = ["x", "y", "t", "force", "altitude", "azimuth", "width", "height", "opacity"] as const;
export type InkField = (typeof INK_FIELDS)[number];

/** What a column a point leaves out means. */
const DEFAULTS: Record<InkField, number> = { x: 0, y: 0, t: 0, force: 1, altitude: 1.571, azimuth: 0, width: 3, height: 3, opacity: 1 };

/** How finely each column is stored: a hundredth of a point, a millisecond, a thousandth of a radian or of a share. */
const STEPS: Record<InkField, number> = { x: 0.01, y: 0.01, t: 1, force: 0.001, altitude: 0.001, azimuth: 0.001, width: 0.01, height: 0.01, opacity: 0.001 };

/** One sampled point, in the units PencilKit uses: points of the canvas, milliseconds, radians. */
export type InkPoint = Record<InkField, number>;

/** A column of points the format has and this code doesn't: its name, and one value per point. */
export type InkExtraColumn = { name: string; values: unknown[] };

export type InkStroke = {
  /** PencilKit's kind of ink as text (`pen`, `marker`…). A name this code doesn't know is kept, and drawn like a pen. */
  ink: string;
  /** A name the scheme resolves (`ink`, `accent`, a `<Mark>` colour) or a fixed `#rrggbb` (lower case). */
  color: string;
  points: InkPoint[];
  extraColumns: InkExtraColumn[];
  /** Members of the stroke this code doesn't know. */
  extra: Record<string, unknown>;
};

export type InkDrawing = {
  width: number;
  height: number;
  strokes: InkStroke[];
  /** Members of the drawing this code doesn't know. */
  extra: Record<string, unknown>;
};

/** A drawing that can't be read, or is too big to be a real page; the message is safe to show. */
export class InkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InkError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The text of a drawing as stored (a PNG's `inKJ` chunk), read. */
export function parseInkText(text: string): InkDrawing {
  // A string's length counts UTF-16 units; the limit is on bytes, which can only be more.
  if (text.length > INK_LIMITS.jsonBytes) throw new InkError("This drawing is too large to open.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InkError("This drawing's JSON is damaged.");
  }
  return parseInk(json);
}

/** A drawing from its JSON value, or an `InkError` that says why not. */
export function parseInk(json: unknown): InkDrawing {
  if (!isRecord(json)) throw new InkError("A drawing is a JSON object.");
  if (json.format !== INK_FORMAT) throw new InkError("This is not a Composition drawing.");
  const { version } = json;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw new InkError("This drawing has no version.");
  if (version > INK_VERSION) throw new InkError("This drawing was made by a newer version of Composition.");

  const { canvas } = json;
  const size = isRecord(canvas) ? [canvas.width, canvas.height] : [];
  if (!(size.length === 2 && size.every((side) => typeof side === "number" && side > 0 && side <= INK_LIMITS.canvas))) {
    throw new InkError("This drawing's canvas has no usable size.");
  }
  const [width, height] = size as [number, number];

  const columns = readFields(json.fields);
  if (!Array.isArray(json.strokes)) throw new InkError("This drawing has no list of strokes.");
  if (json.strokes.length > INK_LIMITS.strokes) throw new InkError("This drawing has too many strokes.");

  let total = 0;
  const strokes = json.strokes.map((value, index) => {
    const stroke = readStroke(value, index + 1, columns);
    total += stroke.points.length;
    if (total > INK_LIMITS.points) throw new InkError("This drawing has too many points.");
    return stroke;
  });

  return { width, height, strokes, extra: membersOtherThan(json, ["format", "version", "canvas", "fields", "strokes"]) };
}

/** Which column of a point is which: a position in `INK_FIELDS`, or the name of a column this code keeps without knowing. */
type Column = { known: InkField } | { extra: string };

function readFields(value: unknown): Column[] {
  if (value === undefined) return INK_FIELDS.map((known) => ({ known }));
  if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) throw new InkError("This drawing's point fields are not a list of names.");
  const names = value as string[];
  if (new Set(names).size !== names.length || !names.includes("x") || !names.includes("y")) {
    throw new InkError("This drawing's point fields must be distinct and include x and y.");
  }
  return names.map((name) => ((INK_FIELDS as readonly string[]).includes(name) ? { known: name as InkField } : { extra: name }));
}

function readStroke(value: unknown, number: number, columns: Column[]): InkStroke {
  if (!isRecord(value)) throw new InkError(`Stroke ${number} is not an object.`);
  const ink = optionalText(value.ink, "pen", `Stroke ${number}'s ink is not text.`);
  const color = readColor(optionalText(value.color, "ink", `Stroke ${number}'s colour is not text.`));
  if (color === null) throw new InkError(`Stroke ${number} has a colour that cannot be read.`);
  if (!Array.isArray(value.points)) throw new InkError(`Stroke ${number} has no points.`);

  const extraNames = columns.flatMap((column) => ("extra" in column ? [column.extra] : []));
  const extraValues: unknown[][] = extraNames.map(() => []);
  const points: InkPoint[] = [];
  for (const row of value.points) {
    if (!Array.isArray(row) || row.length > columns.length) throw new InkError(`Stroke ${number} has a point that does not fit the fields.`);
    const point: InkPoint = { ...DEFAULTS };
    let extraIndex = 0;
    columns.forEach((column, position) => {
      const cell: unknown = position < row.length ? row[position] : null;
      if ("extra" in column) {
        extraValues[extraIndex++].push(cell);
      } else if (cell !== null) {
        if (typeof cell !== "number" || !Number.isFinite(cell)) throw new InkError(`Stroke ${number} has a point with a value that is not a number.`);
        point[column.known] = cell;
      }
    });
    if (Math.abs(point.x) > INK_LIMITS.coordinate || Math.abs(point.y) > INK_LIMITS.coordinate) {
      throw new InkError(`Stroke ${number} has a point far outside the page.`);
    }
    points.push(point);
  }

  return {
    ink,
    color,
    points,
    extraColumns: extraNames.map((name, index) => ({ name, values: extraValues[index] })),
    extra: membersOtherThan(value, ["ink", "color", "points"]),
  };
}

/** `fallback` for a member that is absent; a member that is there must be text (`null` is not). */
function optionalText(value: unknown, fallback: string, message: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new InkError(message);
  return value;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_NAME = /^[a-z0-9-]{1,32}$/;

/** A colour as stored: `#rrggbb` in lower case, or a name (lower case letters, digits and dashes, up to 32); null for anything else. */
export function readColor(text: string): string | null {
  if (HEX_COLOR.test(text)) return text.toLowerCase();
  return COLOR_NAME.test(text) ? text : null;
}

/** `object` without the members `known` names, in their order (a member called `__proto__` stays an ordinary member). */
function membersOtherThan(object: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !known.includes(key)));
}

// MARK: Writing

/** `value` rounded to the decimals of `step`, half away from zero (`Math.round` rounds a negative half the other way). */
export function storedNumber(value: number, step: number): number {
  const scale = Math.round(1 / step);
  const scaled = value * scale;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  // Adding zero turns a negative zero into 0, which is what JSON writes it as anyway.
  return rounded / scale + 0;
}

/** The drawing as it is written: every column named, every number at its step, what was kept after what is known. */
export function inkToJSON(drawing: InkDrawing): Record<string, unknown> {
  const extraNames: string[] = [];
  for (const stroke of drawing.strokes) {
    for (const { name } of stroke.extraColumns) {
      if (!(INK_FIELDS as readonly string[]).includes(name) && !extraNames.includes(name)) extraNames.push(name);
    }
  }

  return {
    format: INK_FORMAT,
    version: INK_VERSION,
    canvas: { width: storedNumber(drawing.width, 0.01), height: storedNumber(drawing.height, 0.01) },
    fields: [...INK_FIELDS, ...extraNames],
    strokes: drawing.strokes.map((stroke) => strokeToJSON(stroke, extraNames)),
    ...membersOtherThan(drawing.extra, ["format", "version", "canvas", "fields", "strokes"]),
  };
}

function strokeToJSON(stroke: InkStroke, extraNames: string[]) {
  const extraColumns = extraNames.map((name) => stroke.extraColumns.find((column) => column.name === name)?.values);
  const points = stroke.points.map((point, index) => [
    ...INK_FIELDS.map((field) => storedNumber(Number.isFinite(point[field]) ? point[field] : DEFAULTS[field], STEPS[field])),
    ...extraColumns.map((values) => values?.[index] ?? null),
  ]);
  return { ink: stroke.ink, color: stroke.color, points, ...membersOtherThan(stroke.extra, ["ink", "color", "points"]) };
}
