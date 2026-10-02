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

export type Frontmatter = {
  title: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
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
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
  return [fm, content.slice(match[0].length)];
}

/** Reassemble content from a (possibly edited) Frontmatter + body. */
export function render(fm: Frontmatter, body: string): string {
  return serialize(fm) + body;
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
  const data = {
    title: fm.title,
    description: fm.description,
    tags: [...fm.tags],
    createdAt: fm.createdAt,
    updatedAt: fm.updatedAt,
  };
  // noArrayIndent matches PyYAML's default_flow_style=False rendering of a
  // block sequence directly under its key (no leading indent before "-"),
  // keeping a note's frontmatter byte-identical whichever app last saved it.
  const yamlText = yaml.dump(data, { sortKeys: false, noArrayIndent: true });
  return `---\n${yamlText}---\n`;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  // js-yaml auto-parses unquoted ISO8601 scalars into Date objects (the YAML 1.1
  // timestamp resolver), so a date typed into the frontmatter by hand is turned
  // back into the string the rest of the app expects.
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function asTagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v !== "");
  }
  if (typeof value === "string") return tagsFromString(value);
  return [];
}
