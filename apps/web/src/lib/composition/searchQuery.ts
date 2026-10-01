/**
 * Parses the search bar's GitHub-style `field: value` syntax into a Meilisearch
 * query. Pure (no network), so it is safe to run on every debounced keystroke.
 * Port of `parse_search_query` in apps/cli/src/composition/search.py, extended to
 * every frontmatter field (see docs/architecture/search.md for the syntax table).
 */

export type ParsedQuery = {
  /** Free text for Meilisearch's typo-tolerant search. May be empty. */
  text: string;
  /** Meilisearch filter clauses, combined with AND. */
  filters: string[];
  /** Restricts which attributes `text` is matched against; undefined means all. */
  attributesToSearchOn?: string[];
};

type Field =
  | { kind: "tag" }
  | { kind: "text"; attribute: "title" | "description" }
  | { kind: "date"; attribute: "created_at_ts" | "updated_at_ts" };

// Lowercased aliases. The frontmatter names (`createdAt`) and the CLI's
// (`createdOn`) both work, so a key can be copied straight from a note.
const FIELDS: Record<string, Field> = {
  tag: { kind: "tag" },
  tags: { kind: "tag" },
  title: { kind: "text", attribute: "title" },
  description: { kind: "text", attribute: "description" },
  created: { kind: "date", attribute: "created_at_ts" },
  createdat: { kind: "date", attribute: "created_at_ts" },
  createdon: { kind: "date", attribute: "created_at_ts" },
  updated: { kind: "date", attribute: "updated_at_ts" },
  updatedat: { kind: "date", attribute: "updated_at_ts" },
  updatedon: { kind: "date", attribute: "updated_at_ts" },
};

const KEY_PATTERN = Object.keys(FIELDS).join("|");
// A key only counts at the start of the string or after whitespace, so the
// `tag:` inside `metatag:x` or a URL stays plain text.
const KEY_AT_START = new RegExp(`^(${KEY_PATTERN}):\\s*`, "i");
const KEY_AHEAD = new RegExp(`\\s(?:${KEY_PATTERN}):`, "i");
const DATE_RE = /^(>=|<=|>|<|=)?(\d{4})-(\d{2})-(\d{2})$/;

/** Escapes a value for use inside a double-quoted Meilisearch filter string. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Filter clauses for `[op]YYYY-MM-DD` over a unix-seconds attribute, or null if malformed. */
function dateFilters(attribute: string, raw: string): string[] | null {
  const match = DATE_RE.exec(raw);
  if (match === null) return null;
  const [, op = "=", year, month, day] = match;
  const start = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(start);
  // Date.UTC rolls 2026-02-31 over to March; treat that as malformed instead.
  if (parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) {
    return null;
  }
  const startTs = Math.floor(start / 1000);
  const endTs = startTs + 86_400;

  switch (op) {
    case ">":
      return [`${attribute} >= ${endTs}`];
    case ">=":
      return [`${attribute} >= ${startTs}`];
    case "<":
      return [`${attribute} < ${startTs}`];
    case "<=":
      return [`${attribute} < ${endTs}`];
    default:
      return [`${attribute} >= ${startTs}`, `${attribute} < ${endTs}`];
  }
}

/**
 * Reads the value after a `key:`. A leading double quote delimits it
 * explicitly (`tags:"web development"`); otherwise it runs up to the next
 * `key:` or the end of the input, so `tags: web development` is the single tag
 * "web development". Returns the value and the index just past it.
 */
function readValue(input: string, from: number): { value: string; end: number } {
  if (input[from] === '"') {
    const close = input.indexOf('"', from + 1);
    if (close === -1) return { value: input.slice(from + 1).trim(), end: input.length };
    return { value: input.slice(from + 1, close).trim(), end: close + 1 };
  }
  const rest = input.slice(from);
  const next = KEY_AHEAD.exec(rest);
  const length = next === null ? rest.length : next.index;
  return { value: rest.slice(0, length).trim(), end: from + length };
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const filters: string[] = [];
  const textAttributes: string[] = [];
  const textValues: string[] = [];
  const freeText: string[] = [];

  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      i++;
      continue;
    }
    // Every iteration starts at a word boundary: the start, or just past whitespace or a value.
    const key = KEY_AT_START.exec(raw.slice(i));
    if (key === null) {
      const next = raw.slice(i).search(/\s/);
      const end = next === -1 ? raw.length : i + next;
      freeText.push(raw.slice(i, end));
      i = end;
      continue;
    }

    const field = FIELDS[key[1].toLowerCase()];
    const { value, end } = readValue(raw, i + key[0].length);
    const consumed = raw.slice(i, end);
    i = end;

    // A half-typed `tags:` has no value yet: ignore it rather than searching for the word "tags:".
    if (value === "") continue;

    if (field.kind === "tag") {
      filters.push(`tags = ${quote(value)}`);
    } else if (field.kind === "text") {
      if (!textAttributes.includes(field.attribute)) textAttributes.push(field.attribute);
      textValues.push(value);
    } else {
      const clauses = dateFilters(field.attribute, value);
      // Malformed date: keep it as literal text, so a half-typed date finds
      // nothing instead of silently dropping the constraint.
      if (clauses === null) freeText.push(consumed.trim());
      else filters.push(...clauses);
    }
  }

  const text = [...textValues, ...freeText]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ")
    .replace(/\s+/g, " ");

  return {
    text,
    filters,
    attributesToSearchOn: textAttributes.length > 0 ? textAttributes : undefined,
  };
}
