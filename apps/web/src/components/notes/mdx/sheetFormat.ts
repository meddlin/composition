/**
 * `TEXT(value, format)`: a number as text, by one of Excel's number formats. Pure, shared with the terminal app.
 *
 * Supported: the digit placeholders `0` and `#`, a decimal point, thousands commas, `%`, text in quotes or after
 * a backslash, literal signs and brackets, up to three sections (`positive;negative;zero`), `@` and `General`,
 * and the date letters `yyyy yy mmmm mmm mm m dddd ddd dd d`. A colour (`[Red]`) is ignored, as it is in a text.
 * Anything else Excel can do (times, fractions, E notation, conditions, a scale such as `#,##0,`, digits with
 * text between them) throws `Unsupported`: the cell says so, and does not show a guess.
 */
import { DAY_NAMES, MONTH_NAMES, dayOfWeek, serialToYmd } from "./sheetDate";
import { ERR, Unsupported, numberToText, roundDigits } from "./sheetValue";

type Token =
  | { kind: "literal"; text: string }
  | { kind: "digit"; char: "0" | "#" }
  | { kind: "point" }
  | { kind: "comma" }
  | { kind: "percent" }
  | { kind: "at" }
  | { kind: "date"; letter: "y" | "m" | "d"; count: number }
  | { kind: "general" };

const COLOURS = /^\[(?:black|blue|cyan|green|magenta|red|white|yellow|color ?\d+)\]$/i;

/** The sections of a format, split on `;` where it is not in quotes, brackets or after a backslash. */
function splitSections(format: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  let bracketed = false;
  for (let i = 0; i < format.length; i++) {
    const char = format[i];
    if (char === "\\" && !quoted) {
      current += char + (format[++i] ?? "");
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "[") bracketed = true;
    else if (!quoted && char === "]") bracketed = false;
    if (char === ";" && !quoted && !bracketed) {
      sections.push(current);
      current = "";
    } else current += char;
  }
  sections.push(current);
  return sections;
}

function tokenize(section: string): Token[] {
  const tokens: Token[] = [];
  const literal = (text: string) => {
    const last = tokens[tokens.length - 1];
    if (last?.kind === "literal") last.text += text;
    else tokens.push({ kind: "literal", text });
  };
  for (let i = 0; i < section.length; i++) {
    const char = section[i];
    const lower = char.toLowerCase();
    if (char === '"') {
      const end = section.indexOf('"', i + 1);
      if (end < 0) throw ERR.VALUE;
      literal(section.slice(i + 1, end));
      i = end;
    } else if (char === "\\") {
      literal(section[++i] ?? "");
    } else if (char === "_") {
      literal(" ");
      i++;
    } else if (char === "*") {
      throw new Unsupported("a number format with a fill character");
    } else if (char === "[") {
      const end = section.indexOf("]", i);
      if (end < 0) throw ERR.VALUE;
      if (!COLOURS.test(section.slice(i, end + 1))) throw new Unsupported("a number format with a condition, a currency or an elapsed time");
      i = end;
    } else if (char === "0" || char === "#") tokens.push({ kind: "digit", char });
    else if (char === "?") throw new Unsupported("a number format with fractions");
    else if (char === ".") tokens.push({ kind: "point" });
    else if (char === ",") tokens.push({ kind: "comma" });
    else if (char === "%") tokens.push({ kind: "percent" });
    else if (char === "@") tokens.push({ kind: "at" });
    else if (lower === "e" && /^e[+-]/i.test(section.slice(i))) throw new Unsupported("a number format in E notation");
    else if (section.slice(i, i + 7).toLowerCase() === "general") {
      tokens.push({ kind: "general" });
      i += 6;
    } else if (lower === "y" || lower === "m" || lower === "d") {
      let count = 1;
      while (section[i + count]?.toLowerCase() === lower) count++;
      tokens.push({ kind: "date", letter: lower, count });
      i += count - 1;
    } else if (lower === "h" || lower === "s" || section.slice(i, i + 4).toUpperCase() === "AM/P" || section.slice(i, i + 3).toUpperCase() === "A/P") {
      throw new Unsupported("a number format with a time");
    } else if (/[$\-+/():!&~{}<>=^' ]/.test(char)) literal(char);
    else if (/[A-Za-z]/.test(char)) throw new Unsupported(`a number format with the letter ${char}`);
    else literal(char);
  }
  return tokens;
}

/** The whole digits `0` to `9` of an integer in groups of three. */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function formatDate(tokens: Token[], serial: number): string {
  if (tokens.some((token) => token.kind === "digit" || token.kind === "percent")) throw new Unsupported("a number format that is both a date and a number");
  if (serial < 0) throw ERR.VALUE;
  const date = serialToYmd(serial);
  if (!date) throw ERR.VALUE;
  const two = (n: number) => String(n).padStart(2, "0");
  return tokens
    .map((token) => {
      if (token.kind === "literal") return token.text;
      // In a date, the comma and the point are just what they look like.
      if (token.kind === "comma") return ",";
      if (token.kind === "point") return ".";
      if (token.kind === "general") return numberToText(serial);
      if (token.kind === "at") return numberToText(serial);
      if (token.kind !== "date") return "";
      const { letter, count } = token;
      if (letter === "y") return count <= 2 ? two(date.year % 100) : String(date.year).padStart(4, "0");
      if (letter === "m")
        return count === 1
          ? String(date.month)
          : count === 2
            ? two(date.month)
            : count === 3
              ? MONTH_NAMES[date.month - 1].slice(0, 3)
              : count === 4
                ? MONTH_NAMES[date.month - 1]
                : MONTH_NAMES[date.month - 1][0];
      return count === 1
        ? String(date.day)
        : count === 2
          ? two(date.day)
          : count === 3
            ? DAY_NAMES[dayOfWeek(serial)].slice(0, 3)
            : DAY_NAMES[dayOfWeek(serial)];
    })
    .join("");
}

function formatDigits(tokens: Token[], value: number, signed: boolean): string {
  const first = tokens.findIndex((token) => token.kind === "digit" || token.kind === "point" || token.kind === "comma");
  if (first < 0) {
    // No digits at all: a format of only text (or `@`) shows that, with the number in General where `@` is.
    return tokens.map((token) => (token.kind === "literal" ? token.text : token.kind === "at" || token.kind === "general" ? numberToText(value) : "")).join("");
  }
  let last = first;
  tokens.forEach((token, index) => {
    if (token.kind === "digit" || token.kind === "point" || token.kind === "comma") last = index;
  });
  const run = tokens.slice(first, last + 1);
  if (run.some((token) => token.kind !== "digit" && token.kind !== "point" && token.kind !== "comma"))
    throw new Unsupported("a number format with text between its digits");
  if (tokens[last].kind === "comma" || run[0].kind === "comma") throw new Unsupported("a number format that scales by thousands");

  const point = run.findIndex((token) => token.kind === "point");
  const integerRun = point < 0 ? run : run.slice(0, point);
  const fractionRun = point < 0 ? [] : run.slice(point + 1);
  if (fractionRun.some((token) => token.kind !== "digit")) throw new Unsupported("a number format with a comma after its decimal point");
  const thousands = integerRun.some((token) => token.kind === "comma");
  const integerSlots = integerRun.filter((token): token is Extract<Token, { kind: "digit" }> => token.kind === "digit");
  const fractionSlots = fractionRun.filter((token): token is Extract<Token, { kind: "digit" }> => token.kind === "digit");
  const percents = tokens.filter((token) => token.kind === "percent").length;
  if (fractionSlots.length > 30) throw new Unsupported("a number format with more than 30 decimals");

  const shown = roundDigits(Math.abs(value) * 100 ** percents, fractionSlots.length);
  const [wholeText, fractionText = ""] = shown.toFixed(fractionSlots.length).split(".");
  const minimum = integerSlots.filter((slot) => slot.char === "0").length;
  let whole = wholeText === "0" && minimum === 0 ? "" : wholeText.padStart(minimum, "0");
  if (thousands) whole = group(whole);
  let fraction = fractionText;
  for (let i = fractionSlots.length - 1; i >= 0 && fractionSlots[i].char === "#" && fraction[i] === "0"; i--) fraction = fraction.slice(0, i);
  // An odd rounding result such as 0.4 under `0` is 0 and carries no sign.
  const minus = signed && shown !== 0 ? "-" : "";

  const number = `${whole}${point >= 0 ? "." : ""}${fraction}`;
  const text = (part: Token[]) =>
    part.map((token) => (token.kind === "literal" ? token.text : token.kind === "percent" ? "%" : token.kind === "at" ? numberToText(value) : "")).join("");
  return minus + text(tokens.slice(0, first)) + number + text(tokens.slice(last + 1));
}

/**
 * A number as text by a format, as `TEXT` does. Throws `#VALUE!` for a format Excel rejects and `Unsupported`
 * for one it accepts and we do not draw.
 */
export function formatNumber(value: number, format: string): string {
  if (format === "") return "";
  const sections = splitSections(format);
  if (sections.length > 4) throw ERR.VALUE;
  const negative = value < 0;
  // With one section it serves every number, and a negative gets its sign; with more, the second is for negatives, and shows its own.
  const index = negative && sections.length >= 2 ? 1 : value === 0 && sections.length >= 3 ? 2 : 0;
  const tokens = tokenize(sections[index]);
  if (tokens.length === 1 && tokens[0].kind === "general") return (negative && index === 0 ? "-" : "") + numberToText(Math.abs(value));
  if (tokens.some((token) => token.kind === "date")) return formatDate(tokens, value);
  return formatDigits(tokens, value, negative && index === 0);
}
