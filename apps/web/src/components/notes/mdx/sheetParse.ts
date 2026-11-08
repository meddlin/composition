/**
 * A formula as a tree: `=SUMIFS(C2:C9,A2:A9,"West")` is read here and calculated in sheetFormula.ts. Pure,
 * with no `eval` (the desktop CSP forbids it) and no parser toolkit, shared with the terminal app.
 *
 * It reads Excel's own syntax, with its precedence: negation binds tighter than `%`, which binds tighter than `^`
 * (so `-2^2` is 4), then `* /`, `+ -`, `&`, and the comparisons last; `^` goes left to right (`2^3^2` is 64).
 * What it reads but does not calculate (another sheet, a table's `[Column]`, a name) becomes a node of its own,
 * so the cell can say what it could not do; what it cannot read at all throws `SyntaxProblem`.
 */
import { type SheetError, errorByCode, parseLiteral } from "./sheetValue";

export type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: SheetError }
  /** A cell or a range, from 0. `r2` is `Infinity` for a whole column (`B:B`), and `c2` for a whole row (`3:3`). */
  | { t: "ref"; r1: number; c1: number; r2: number; c2: number; range: boolean }
  | { t: "unary"; op: "-" | "+"; a: Node }
  | { t: "percent"; a: Node }
  | {
      t: "bin";
      op: "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";
      a: Node;
      b: Node;
    }
  /** A function call; an argument left out (`ROUND(2.5,)`) is `null`. */
  | { t: "call"; name: string; args: (Node | null)[] }
  /** Parentheses are kept: Excel treats `=(0.1+0.2-0.3)` and `=0.1+0.2-0.3` differently. */
  | { t: "paren"; a: Node }
  | { t: "array"; rows: Node[][] }
  /** Something it reads but does not calculate, with the reason shown in the cell. */
  | { t: "unsupported"; reason: string };

export class SyntaxProblem {
  constructor(readonly message: string) {}
}

type Token = {
  kind: "num" | "str" | "ident" | "op" | "err" | "structured";
  text: string;
  value?: string;
};

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
// A cell (`B7`, `$B$7`, `B$7`) first, unless a function name follows it (`LOG10(`); then names and functions; then a column's `$B` in `$B:$D`.
const IDENT = /^\$?[A-Za-z]{1,3}\$?\d+(?![A-Za-z0-9_.(])|^[A-Za-z_][A-Za-z0-9_.]*|^\$[A-Za-z]{1,3}/;
const ERROR_LITERAL = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)/;
const OPERATORS = ["<>", "<=", ">=", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%", ":", ",", "(", ")", ";", "{", "}", "!", "@"];

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const char = rest[0];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ kind: "num", text: number[0] });
      i += number[0].length;
    } else if (char === '"') {
      let value = "";
      let j = 1;
      for (;;) {
        if (j >= rest.length) throw new SyntaxProblem("a text without its closing quote");
        if (rest[j] === '"' && rest[j + 1] === '"') {
          value += '"';
          j += 2;
        } else if (rest[j] === '"') break;
        else value += rest[j++];
      }
      tokens.push({ kind: "str", text: rest.slice(0, j + 1), value });
      i += j + 1;
    } else if (char === "'") {
      // A quoted sheet name: 'Q3 budget'!A1
      let j = 1;
      for (;;) {
        if (j >= rest.length) throw new SyntaxProblem("a sheet name without its closing quote");
        if (rest[j] === "'" && rest[j + 1] === "'") j += 2;
        else if (rest[j] === "'") break;
        else j++;
      }
      tokens.push({ kind: "ident", text: rest.slice(0, j + 1) });
      i += j + 1;
    } else if (char === "#") {
      const error = ERROR_LITERAL.exec(rest);
      if (!error) throw new SyntaxProblem(`the text ${rest.slice(0, 8)}`);
      tokens.push({ kind: "err", text: error[0] });
      i += error[0].length;
    } else if (char === "[") {
      let depth = 0;
      let j = 0;
      for (; j < rest.length; j++) {
        if (rest[j] === "[") depth++;
        else if (rest[j] === "]" && --depth === 0) break;
      }
      if (j >= rest.length) throw new SyntaxProblem("a [ without its ]");
      tokens.push({ kind: "structured", text: rest.slice(0, j + 1) });
      i += j + 1;
    } else {
      const ident = IDENT.exec(rest);
      if (ident) {
        tokens.push({ kind: "ident", text: ident[0] });
        i += ident[0].length;
        continue;
      }
      const op = OPERATORS.find((candidate) => rest.startsWith(candidate));
      if (!op) throw new SyntaxProblem(`the character ${char}`);
      tokens.push({ kind: "op", text: op });
      i += op.length;
    }
  }
  return tokens;
}

/** Excel's limits: 64 levels of nesting, and a formula of 8,192 characters at most. */
const MAX_NESTING = 64;
const MAX_LENGTH = 8192;

const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

/** A column's letters as its number from 0, or `-1` past XFD. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index <= MAX_COLUMN ? index - 1 : -1;
}

/** A cell address (`B7`, `$B$7`) as from-0 numbers, or `undefined` if it is not one. */
export function parseAddress(text: string): { row: number; col: number } | undefined {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text);
  if (!match) return undefined;
  const col = columnIndex(match[1]);
  const row = Number(match[2]);
  return col < 0 || row < 1 || row > MAX_ROW ? undefined : { row: row - 1, col };
}

const PREFIX = /^(?:_xlfn\.)?(?:_xlws\.)?/i;

class Parser {
  private at = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (this.tokens.length === 0) throw new SyntaxProblem("an empty formula");
    const node = this.comparison();
    if (this.at < this.tokens.length) throw new SyntaxProblem(`“${this.tokens[this.at].text}” where an operator was expected`);
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private isOp(text: string) {
    const token = this.peek();
    return token?.kind === "op" && token.text === text;
  }

  private take(): Token {
    const token = this.tokens[this.at++];
    if (!token) throw new SyntaxProblem("a formula that stops too soon");
    return token;
  }

  private expect(text: string) {
    if (!this.isOp(text)) throw new SyntaxProblem(`“${text}” expected`);
    this.at++;
  }

  private comparison(): Node {
    let a = this.concat();
    for (;;) {
      const token = this.peek();
      if (token?.kind === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(token.text)) {
        this.at++;
        a = { t: "bin", op: token.text as "=", a, b: this.concat() };
      } else return a;
    }
  }

  private concat(): Node {
    let a = this.additive();
    while (this.isOp("&")) {
      this.at++;
      a = { t: "bin", op: "&", a, b: this.additive() };
    }
    return a;
  }

  private additive(): Node {
    let a = this.multiplicative();
    for (;;) {
      if (this.isOp("+") || this.isOp("-")) {
        const op = this.take().text as "+" | "-";
        a = { t: "bin", op, a, b: this.multiplicative() };
      } else return a;
    }
  }

  private multiplicative(): Node {
    let a = this.power();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = this.take().text as "*" | "/";
        a = { t: "bin", op, a, b: this.power() };
      } else return a;
    }
  }

  private power(): Node {
    let a = this.percent();
    while (this.isOp("^")) {
      this.at++;
      a = { t: "bin", op: "^", a, b: this.percent() };
    }
    return a;
  }

  private percent(): Node {
    let a = this.unary();
    while (this.isOp("%")) {
      this.at++;
      a = { t: "percent", a };
    }
    return a;
  }

  private unary(): Node {
    const ops: ("-" | "+")[] = [];
    while (this.isOp("-") || this.isOp("+")) {
      ops.push(this.take().text as "-" | "+");
      if (ops.length > MAX_NESTING) throw new SyntaxProblem(`more than ${MAX_NESTING} signs in a row`);
    }
    let node = this.primary();
    for (let i = ops.length - 1; i >= 0; i--) node = { t: "unary", op: ops[i], a: node };
    return node;
  }

  /** Parentheses, calls and array constants nest to a limit, as in Excel, so that a formula cannot be made to overflow the stack. */
  private nested<T>(parse: () => T): T {
    if (++this.depth > MAX_NESTING) throw new SyntaxProblem(`more than ${MAX_NESTING} levels of nesting`);
    try {
      return parse();
    } finally {
      this.depth--;
    }
  }

  private primary(): Node {
    const token = this.take();
    switch (token.kind) {
      case "num": {
        // Row ranges, `3:5`.
        if (this.isOp(":") && /^\d+$/.test(token.text)) {
          const next = this.tokens[this.at + 1];
          if (next?.kind === "num" && /^\d+$/.test(next.text)) {
            this.at += 2;
            const [r1, r2] = [Number(token.text), Number(next.text)].sort((x, y) => x - y);
            return {
              t: "ref",
              r1: r1 - 1,
              c1: 0,
              r2: r2 - 1,
              c2: Infinity,
              range: true,
            };
          }
        }
        return { t: "num", v: parseLiteral(token.text) };
      }
      case "str":
        return { t: "str", v: token.value ?? "" };
      case "err": {
        const error = errorByCode(token.text);
        if (!error) throw new SyntaxProblem(`the error ${token.text}`);
        return { t: "err", v: error };
      }
      case "structured":
        return { t: "unsupported", reason: "a table's column reference" };
      case "op":
        return this.operand(token);
      default:
        return this.identifier(token);
    }
  }

  private operand(token: Token): Node {
    if (token.text === "(") {
      const a = this.nested(() => this.comparison());
      this.expect(")");
      return { t: "paren", a };
    }
    if (token.text === "{") return this.arrayConstant();
    if (token.text === "@") return { t: "unsupported", reason: "the @ operator" };
    throw new SyntaxProblem(`“${token.text}” where a value was expected`);
  }

  private arrayConstant(): Node {
    const rows: Node[][] = [[]];
    for (;;) {
      rows[rows.length - 1].push(this.constant());
      if (this.isOp(",")) this.at++;
      else if (this.isOp(";")) {
        this.at++;
        rows.push([]);
      } else break;
    }
    this.expect("}");
    if (rows.some((row) => row.length !== rows[0].length)) throw new SyntaxProblem("an array whose rows differ in length");
    return { t: "array", rows };
  }

  private constant(): Node {
    const node = this.unary();
    const literal = (n: Node): boolean => n.t === "num" || n.t === "str" || n.t === "bool" || n.t === "err" || (n.t === "unary" && literal(n.a));
    if (!literal(node)) throw new SyntaxProblem("an array with something other than values in it");
    return node;
  }

  private identifier(token: Token): Node {
    const name = token.text;
    if (this.isOp("(") && /^[A-Za-z_]/.test(name)) return this.call(name);
    if (this.isOp("!") || name.startsWith("'")) {
      // Another sheet: Sheet1!A1, 'Sheet 1'!A1:B2. Read past the reference.
      if (this.isOp("!")) this.at++;
      if (this.peek()?.kind === "ident" || this.peek()?.kind === "structured") this.at++;
      if (this.isOp(":") && this.tokens[this.at + 1]?.kind === "ident") this.at += 2;
      return { t: "unsupported", reason: "a reference to another sheet" };
    }
    if (this.peek()?.kind === "structured") {
      this.at++;
      return { t: "unsupported", reason: "a table's column reference" };
    }
    const cell = parseAddress(name);
    if (cell) {
      if (this.isOp(":")) {
        const next = this.tokens[this.at + 1];
        const end = next?.kind === "ident" ? parseAddress(next.text) : undefined;
        if (!end) throw new SyntaxProblem("a range that does not end in a cell");
        this.at += 2;
        return {
          t: "ref",
          r1: Math.min(cell.row, end.row),
          c1: Math.min(cell.col, end.col),
          r2: Math.max(cell.row, end.row),
          c2: Math.max(cell.col, end.col),
          range: true,
        };
      }
      return {
        t: "ref",
        r1: cell.row,
        c1: cell.col,
        r2: cell.row,
        c2: cell.col,
        range: false,
      };
    }
    if (/^\$?[A-Za-z]{1,3}$/.test(name) && this.isOp(":")) {
      // Whole columns, B:B or B:D.
      const next = this.tokens[this.at + 1];
      if (next?.kind === "ident" && /^\$?[A-Za-z]{1,3}$/.test(next.text)) {
        this.at += 2;
        const a = columnIndex(name.replace(/\$/g, ""));
        const b = columnIndex(next.text.replace(/\$/g, ""));
        if (a < 0 || b < 0) throw new SyntaxProblem("a column past XFD");
        return {
          t: "ref",
          r1: 0,
          c1: Math.min(a, b),
          r2: Infinity,
          c2: Math.max(a, b),
          range: true,
        };
      }
    }
    const upper = name.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE") return { t: "bool", v: upper === "TRUE" };
    return { t: "unsupported", reason: `the name ${name}` };
  }

  private call(rawName: string): Node {
    const name = rawName.toUpperCase().replace(PREFIX, "");
    this.expect("(");
    const args: (Node | null)[] = [];
    if (this.isOp(")")) {
      this.at++;
      return { t: "call", name, args };
    }
    for (;;) {
      args.push(this.isOp(",") || this.isOp(")") ? null : this.nested(() => this.comparison()));
      if (this.isOp(",")) this.at++;
      else break;
    }
    this.expect(")");
    return { t: "call", name, args };
  }
}

/** A formula (with or without its leading `=`) as a tree. Throws `SyntaxProblem` for text that is not one. */
export function parseFormula(text: string): Node {
  if (text.length > MAX_LENGTH) throw new SyntaxProblem(`longer than the ${MAX_LENGTH.toLocaleString("en-US")} characters Excel allows`);
  return new Parser(tokenize(text.trim().replace(/^=/, ""))).parse();
}
