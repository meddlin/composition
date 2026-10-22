/**
 * Parsing/generation of the YAML frontmatter block at the top of a note.
 * The terminal app and the desktop app use this same module, and every note already
 * stored has frontmatter written by it (or by the Python CLI that preceded it), so the
 * output format must stay stable: it's what lets notes written by one app stay readable
 * by the others.
 */
import yaml from "js-yaml";

// The opening `---` line, a non-greedy YAML body, then the closing `---` line:
// anchored at the very start of the string (not per line).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

/** How a note's header image sits above its title: across the whole note, or at its own size in the middle. */
export type HeaderImageLayout = "full" | "centered";

export const HEADER_IMAGE_LAYOUTS: readonly HeaderImageLayout[] = ["full", "centered"];

export type Frontmatter = {
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * A picture shown above the note's title in the preview: `app_data/<name>` for a stored image, or an
   * `https://` address. Absent (not empty) when the note has none, so a note without one is written
   * exactly as it was before this existed.
   */
  headerImage?: string;
  /** Only meaningful with `headerImage`; a missing or unreadable value means `full`. */
  headerImageLayout?: HeaderImageLayout;
};

export function generate(
  title: string,
  {
    createdAt,
    updatedAt,
    description = "",
    tags = [],
  }: { createdAt: string; updatedAt: string; description?: string; tags?: string[] },
): string {
  return serialize({ title, description, tags: [...tags], createdAt, updatedAt });
}

/**
 * Split content into [frontmatter, body]. Returns [null, content] unchanged
 * if there is no '---' block at the very top, the block isn't a YAML
 * mapping, or the YAML fails to parse — this must never throw, since the
 * block is free-form user-edited text.
 */
export function parse(content: string): [Frontmatter | null, string] {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) return [null, content];

  let data: unknown;
  try {
    data = yaml.load(match[1]);
  } catch {
    return [null, content];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [null, content];
  }

  const record = data as Record<string, unknown>;
  const fm: Frontmatter = {
    title: asString(record.title),
    description: asString(record.description),
    tags: asTagList(record.tags),
    createdAt: toDateOnly(asString(record.createdAt)),
    updatedAt: toDateOnly(asString(record.updatedAt)),
  };
  const headerImage = asString(record.headerImage).trim();
  if (headerImage !== "") {
    fm.headerImage = headerImage;
    fm.headerImageLayout = asLayout(record.headerImageLayout);
  }
  return [fm, content.slice(match[0].length)];
}

/** Reassemble content from a (possibly edited) Frontmatter + body. */
export function render(fm: Frontmatter, body: string): string {
  return serialize(fm) + body;
}

/**
 * `content` with its header image set to `image` (null removes it), keeping everything else.
 * A note that has no frontmatter block gets one made from `fallback`, which is why that is needed.
 */
export function withHeaderImage(
  content: string,
  header: { image: string; layout: HeaderImageLayout } | null,
  fallback: Pick<Frontmatter, "title" | "createdAt" | "updatedAt">,
): string {
  const [parsed, body] = parse(content);
  const fm: Frontmatter = parsed ?? { ...fallback, description: "", tags: [] };
  delete fm.headerImage;
  delete fm.headerImageLayout;
  if (header) {
    fm.headerImage = header.image;
    fm.headerImageLayout = header.layout;
  }
  return render(fm, body);
}

/** Content with any leading frontmatter block removed, for the preview pane. */
export function strip(content: string): string {
  const [, body] = parse(content);
  return body;
}

/** YAML list -> DB's comma-joined tags string. */
export function tagsToString(tags: string[]): string {
  return tags
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .join(",");
}

/** DB's comma-joined tags string -> YAML list. */
export function tagsFromString(tags: string): string[] {
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

function serialize(fm: Frontmatter): string {
  const data: Record<string, unknown> = {
    title: fm.title,
    description: fm.description,
    tags: [...fm.tags],
    createdAt: toDateOnly(fm.createdAt),
    updatedAt: toDateOnly(fm.updatedAt),
  };
  // After the keys every version has always written, and only when set.
  if (fm.headerImage) {
    data.headerImage = fm.headerImage;
    data.headerImageLayout = fm.headerImageLayout ?? "full";
  }
  // noArrayIndent matches PyYAML's default_flow_style=False rendering of a
  // block sequence directly under its key (no leading indent before "-"),
  // keeping a note's frontmatter byte-identical whichever app last saved it.
  // A bare date would be read back as a timestamp, so js-yaml quotes it; unquote it so the editor shows plain dates.
  const yamlText = yaml
    .dump(data, { sortKeys: false, noArrayIndent: true })
    .replace(/^(createdAt|updatedAt): '(\d{4}-\d{2}-\d{2})'$/gm, "$1: $2");
  return `---\n${yamlText}---\n`;
}

/**
 * The frontmatter shows only the date; the full timestamp lives in the database.
 * Takes the leading YYYY-MM-DD of an ISO string as written (no timezone conversion);
 * anything else is left alone.
 */
function toDateOnly(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(value.trim());
  return match ? match[1] : value;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  // js-yaml auto-parses unquoted ISO8601 scalars into Date objects (the YAML 1.1
  // timestamp resolver), so a date typed into the frontmatter by hand is turned
  // back into the string the rest of the app expects.
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asLayout(value: unknown): HeaderImageLayout {
  const layout = asString(value).trim().toLowerCase();
  return HEADER_IMAGE_LAYOUTS.find((known) => known === layout) ?? "full";
}

function asTagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v !== "");
  }
  if (typeof value === "string") return tagsFromString(value);
  return [];
}
