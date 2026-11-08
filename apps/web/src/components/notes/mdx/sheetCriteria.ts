/**
 * Excel's criteria, the second argument of `COUNTIF`, `SUMIFS` and the rest of that family, and the wildcards
 * that `MATCH`, `SEARCH` and `XLOOKUP` share. Pure, shared with the terminal app.
 *
 * This is the part of Excel that a function library gets wrong (formulajs matched Excel on 15 of 34 cases,
 * and its `SUMIFS` is case-sensitive and knows no wildcards), so the engine owns it. Each rule below was read off
 * real Excel: spikes/sheet/excel-verified-cases.json.
 */
import { type Scalar, type SheetError, Unsupported, compareText, errorByCode, isError, logicalText, parseNumberText, round15 } from "./sheetValue";

/** Whether a cell is the one a criterion picks. */
export type Criterion = (cell: Scalar) => boolean;

const WILDCARD = /[*?~]/;

/** A wildcard pattern as tokens: `*` (any run), `?` (any one character), or a character to match as it is, in lower case. */
type Token = { any: true } | { one: true } | { literal: string };

function tokenize(pattern: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    // `~` takes the next `*`, `?` or `~` literally; before anything else it is just a tilde.
    if (char === "~" && i + 1 < pattern.length && WILDCARD.test(pattern[i + 1])) tokens.push({ literal: pattern[++i] });
    else if (char === "*") tokens.push({ any: true });
    else if (char === "?") tokens.push({ one: true });
    else tokens.push({ literal: char.toLowerCase() });
  }
  return tokens;
}

/**
 * Whether the tokens match `text` from `start`: all of it, or (with `prefix`) the start of what is left. Done by walking the text
 * once and going back only to the last `*`, so it takes no more than the length of the text times the length of the pattern, however
 * many stars there are: a regular expression built from `*a*a*a*b` can take longer than the age of the sheet.
 */
function matchFrom(tokens: Token[], text: string, start: number, prefix: boolean): boolean {
  let t = start;
  let p = 0;
  let star = -1;
  let mark = start;
  for (;;) {
    if (prefix && p === tokens.length) return true;
    if (t >= text.length) break;
    const token = p < tokens.length ? tokens[p] : undefined;
    if (token && "one" in token) {
      t++;
      p++;
    } else if (token && "literal" in token && text[t].toLowerCase() === token.literal) {
      t++;
      p++;
    } else if (token && "any" in token) {
      star = p++;
      mark = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++mark;
    } else return false;
  }
  while (p < tokens.length && "any" in tokens[p]) p++;
  return p === tokens.length;
}

/** A test of a whole text against a pattern with Excel's wildcards (`*` any run, `?` any one character, `~` to mean the next one literally), ignoring case. */
export function wildcardMatcher(pattern: string): (text: string) => boolean {
  const tokens = tokenize(pattern);
  return (text) => matchFrom(tokens, text, 0, false);
}

/** The place, from 0, where a pattern first matches inside a text (as `SEARCH` finds one), or -1. */
export function wildcardFind(pattern: string, text: string, from = 0): number {
  const tokens = tokenize(pattern);
  for (let start = from; start <= text.length; start++) if (matchFrom(tokens, text, start, true)) return start;
  return -1;
}

/** Whether a text has a wildcard in it, so a plain comparison will not do. */
export const hasWildcard = (text: string) => WILDCARD.test(text);

/** Whether `text` is `pattern`, ignoring case, with wildcards where the pattern has them. */
export function matchesPattern(pattern: string, text: string): boolean {
  return hasWildcard(pattern) ? wildcardMatcher(pattern)(text) : compareText(pattern, text) === 0;
}

const OPERATORS = [">=", "<=", "<>", ">", "<", "="] as const;
type Operator = (typeof OPERATORS)[number] | "";

const isNumeric = (cell: Scalar): cell is number => typeof cell === "number";

/** A number criterion `n`: equal, by their first 15 digits, to a number; or to a text that reads as that number, but only for `=`. */
function numeric(operator: Operator, n: number): Criterion {
  const target = round15(n);
  const equal: Criterion = (cell) => {
    if (isNumeric(cell)) return round15(cell) === target;
    if (typeof cell !== "string") return false;
    try {
      const read = parseNumberText(cell);
      return read !== null && round15(read) === target;
    } catch (error) {
      if (error instanceof Unsupported) return false;
      throw error;
    }
  };
  switch (operator) {
    case "":
    case "=":
      return equal;
    case "<>":
      return (cell) => !equal(cell);
    case ">":
      return (cell) => isNumeric(cell) && round15(cell) > target;
    case ">=":
      return (cell) => isNumeric(cell) && round15(cell) >= target;
    case "<":
      return (cell) => isNumeric(cell) && round15(cell) < target;
    default:
      return (cell) => isNumeric(cell) && round15(cell) <= target;
  }
}

/** A text criterion: with `=` (or none), a match of the whole cell, wildcards and all; with `<>`, any cell that is not; with an order, the texts that sort so. */
function textual(operator: Operator, text: string): Criterion {
  if (text === "") {
    // An empty criterion is a blank cell, or an empty text (`=` is only a blank cell); `<>` is every cell that is not blank.
    if (operator === "") return (cell) => cell === null || cell === "";
    if (operator === "=") return (cell) => cell === null;
    if (operator === "<>") return (cell) => cell !== null;
  }
  const matches: (cell: string) => boolean = hasWildcard(text) ? wildcardMatcher(text) : (cell) => compareText(cell, text) === 0;
  switch (operator) {
    case "":
    case "=":
      return (cell) => typeof cell === "string" && matches(cell);
    case "<>":
      return (cell) => !(typeof cell === "string" && matches(cell));
    case ">":
      return (cell) => typeof cell === "string" && compareText(cell, text) > 0;
    case ">=":
      return (cell) => typeof cell === "string" && compareText(cell, text) >= 0;
    case "<":
      return (cell) => typeof cell === "string" && compareText(cell, text) < 0;
    default:
      return (cell) => typeof cell === "string" && compareText(cell, text) <= 0;
  }
}

function logical(operator: Operator, value: boolean): Criterion {
  const equal: Criterion = (cell) => cell === value;
  if (operator === "" || operator === "=") return equal;
  if (operator === "<>") return (cell) => !equal(cell);
  throw new Unsupported("a criterion that orders logical values");
}

function errorCriterion(operator: Operator, error: SheetError): Criterion {
  const equal: Criterion = (cell) => isError(cell) && cell.code === error.code;
  if (operator === "" || operator === "=") return equal;
  if (operator === "<>") return (cell) => !equal(cell);
  throw new Unsupported("a criterion that orders error values");
}

/**
 * The test a criterion stands for. A number is "equal to it"; a text may start with an operator (`">=5"`,
 * `"<>apple"`) and what follows is read as a number, a logical, an error or text, in that order, so `"30"` and
 * `30` are the same criterion. Throws `Unsupported` for what Excel would read as a date.
 */
export function parseCriterion(criteria: Scalar): Criterion {
  if (isError(criteria)) return errorCriterion("", criteria);
  if (criteria === null) return numeric("", 0);
  if (typeof criteria === "number") return numeric("", criteria);
  if (typeof criteria === "boolean") return logical("", criteria);

  const operator: Operator = OPERATORS.find((candidate) => criteria.startsWith(candidate)) ?? "";
  const operand = criteria.slice(operator.length);
  const number = operand.trim() === "" ? null : parseNumberText(operand);
  if (number !== null) return numeric(operator, number);
  const flag = logicalText(operand.trim());
  if (flag !== undefined) return logical(operator, flag);
  const error = errorByCode(operand.trim());
  if (error) return errorCriterion(operator, error);
  return textual(operator, operand);
}
