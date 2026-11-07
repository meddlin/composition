/**
 * Sample note content for the stress-test databases (see generate.mjs): lorem ipsum, generated stories, generated
 * test code, MDX component notes, and a fixed set of edge cases. Everything draws from one seeded random source, so the
 * same seed always produces the same notes.
 */

// ---------------------------------------------------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------------------------------------------------

/** mulberry32: tiny, fast, and good enough for sample data. */
export function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** Integer in [min, max]. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** `entries` is [[value, weight], ...]. */
    weighted(entries) {
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    /** Log-normal with the given median; `sigma` is how heavy the tail is. */
    lognormal(median, sigma) {
      const u = Math.max(next(), 1e-9);
      const v = next();
      const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return median * Math.exp(sigma * normal);
    },
    shuffle(list) {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    hex(length) {
      let out = "";
      while (out.length < length) out += Math.floor(next() * 16).toString(16);
      return out;
    },
  };
  return rng;
}

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---------------------------------------------------------------------------------------------------------------------
// Lorem ipsum
// ---------------------------------------------------------------------------------------------------------------------

const LOREM_WORDS =
  `lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua
enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in
reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt
culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus nunc maximus pellentesque
habitant morbi tristique senectus netus malesuada fames ac turpis egestas vestibulum tortor quam feugiat vitae ultricies
integer quis auctor elit sed vulputate mi sit amet mauris commodo quis imperdiet massa tincidunt nunc pulvinar sapien
et ligula ullamcorper malesuada proin libero nunc consequat interdum varius sit amet mattis vulputate enim nulla
aliquet porttitor lacus luctus accumsan tortor posuere ac ut consequat semper viverra nam libero justo laoreet sit amet
cursus sit amet dictum sit amet justo donec enim diam vulputate ut pharetra sit amet aliquam id diam`
    .split(/\s+/)
    .filter(Boolean);

export function loremSentence(r, words = r.int(6, 18)) {
  const out = [];
  for (let i = 0; i < words; i++) out.push(r.pick(LOREM_WORDS));
  if (words > 8 && r.chance(0.5)) out[r.int(3, words - 3)] += ",";
  return `${cap(out.join(" "))}.`;
}

export function loremParagraph(r, sentences = r.int(2, 6)) {
  const out = [];
  for (let i = 0; i < sentences; i++) out.push(decorate(r, loremSentence(r)));
  return out.join(" ");
}

export function loremTitle(r) {
  const n = r.int(2, 6);
  const words = [];
  for (let i = 0; i < n; i++) words.push(r.pick(LOREM_WORDS));
  return cap(words.join(" "));
}

/** Sprinkles inline Markdown (bold, italic, code, a link, strikethrough) over a sentence. */
function decorate(r, sentence) {
  if (!r.chance(0.35)) return sentence;
  const words = sentence.split(" ");
  const i = r.int(0, words.length - 1);
  const word = words[i].replace(/[.,]$/, "");
  const tail = words[i].slice(word.length);
  const wrapped = r.weighted([
    [`**${word}**`, 3],
    [`*${word}*`, 3],
    [`\`${word}\``, 2],
    [`~~${word}~~`, 1],
    [`[${word}](https://example.com/${word})`, 2],
  ]);
  words[i] = wrapped + tail;
  return words.join(" ");
}

function loremList(r, ordered = r.chance(0.4)) {
  const n = r.int(3, 8);
  const lines = [];
  for (let i = 0; i < n; i++) {
    lines.push(`${ordered ? `${i + 1}.` : "-"} ${decorate(r, loremSentence(r, r.int(3, 10)))}`);
    if (r.chance(0.2)) lines.push(`   - ${loremSentence(r, r.int(3, 7))}`);
  }
  return lines.join("\n");
}

function loremQuote(r) {
  return `> ${loremSentence(r, r.int(8, 20))}\n> ${loremSentence(r, r.int(5, 12))}`;
}

function loremTable(r, rows = r.int(2, 8)) {
  const cols = r.int(2, 5);
  const head = Array.from({ length: cols }, () => cap(r.pick(LOREM_WORDS)));
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (let i = 0; i < rows; i++) {
    lines.push(`| ${Array.from({ length: cols }, () => (r.chance(0.3) ? String(r.int(0, 9999)) : r.pick(LOREM_WORDS))).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** A document of headings, paragraphs, lists, quotes and tables, about `target` characters long. */
export function loremDocument(r, target) {
  const parts = [`# ${loremTitle(r)}`];
  let size = parts[0].length;
  while (size < target) {
    const block = r.weighted([
      [() => `## ${loremTitle(r)}`, 2],
      [() => `### ${loremTitle(r)}`, 1],
      [() => loremParagraph(r), 10],
      [() => loremList(r), 2],
      [() => loremQuote(r), 1],
      [() => loremTable(r), 1],
      [() => "---", 0.3],
    ])();
    parts.push(block);
    size += block.length + 2;
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Generated stories
// ---------------------------------------------------------------------------------------------------------------------

const FIRST_NAMES = ["Ada", "Bram", "Cleo", "Dara", "Elio", "Fenn", "Gwen", "Hale", "Iris", "Jory", "Kit", "Lena", "Milo", "Nell", "Orin", "Pia", "Quill", "Rhea", "Soren", "Tamsin", "Ula", "Vik", "Wren", "Xan", "Yara", "Zed"];
const LAST_NAMES = ["Ashdown", "Brightwater", "Cinder", "Dunmore", "Everhart", "Fairweather", "Greaves", "Holloway", "Ironwood", "Juniper", "Kestrel", "Lockwood", "Marrow", "Nightingale", "Oakhurst", "Pennywhistle", "Quartermain", "Rookwood", "Stormcrow", "Thistledown"];
const PLACES = ["the salt flats of Verrin", "an orbital laundromat", "the drowned library", "Lantern Street", "a lighthouse with no sea", "the last bus depot", "the glass orchard", "Station Nine", "the museum of small weather", "a village that kept moving", "the clockmakers' quarter", "the copper canyon"];
const OBJECTS = ["brass compass", "folded map", "talking kettle", "paper moon", "cracked lantern", "silent radio", "borrowed key", "velvet ledger", "ticking suitcase", "clockwork sparrow", "unsent letter", "map of nowhere"];
const ADJ = ["quiet", "restless", "improbable", "luminous", "forgotten", "stubborn", "hollow", "gentle", "unfinished", "peculiar", "wandering", "borrowed", "tangled"];
const NOUNS = ["Harbor", "Orchard", "Engine", "Cartographer", "Garden", "Archive", "Signal", "Lighthouse", "Staircase", "Telegram", "Tide", "Orchestra", "Inheritance"];
const VERBS = ["hesitated", "laughed", "pocketed the thing", "counted the steps", "closed the door softly", "stared at the horizon", "rewound the tape", "poured two cups", "ignored the warning", "lit the stove", "traced the route", "whistled once"];
const FEELINGS = ["a prickle of doubt", "an odd, bright calm", "the old familiar dread", "something close to hope", "a hunger for answers", "the weight of a promise"];
const SPEECH = ["We were never supposed to find this", "Tell me the part you left out", "The map is wrong, or the world is", "I kept it safe, I swear", "Nobody comes here anymore", "You can still turn back", "It was already open when I arrived", "Every clock in town agrees, and that is the problem"];

const SENTENCES = [
  (c) => `${c.hero} ${c.r.pick(VERBS)} and looked at the ${c.r.pick(ADJ)} ${c.r.pick(OBJECTS)}.`,
  (c) => `In ${c.place}, nothing was ever quite where ${c.hero} had left it.`,
  (c) => `${c.friend} arrived late, carrying a ${c.r.pick(OBJECTS)} and ${c.r.pick(FEELINGS)}.`,
  (c) => `"${c.r.pick(SPEECH)}," said ${c.friend}.`,
  (c) => `"${c.r.pick(SPEECH)}," ${c.hero} answered, and ${c.r.pick(VERBS)}.`,
  (c) => `It had been ${c.r.int(3, 40)} years since anyone ${c.r.pick(VERBS)} in ${c.place}.`,
  (c) => `${c.hero} felt ${c.r.pick(FEELINGS)}, though the ${c.r.pick(OBJECTS)} gave no explanation.`,
  (c) => `By ${c.r.pick(["dawn", "noon", "midnight", "the third bell", "closing time"])}, the ${c.r.pick(ADJ)} ${c.r.pick(NOUNS).toLowerCase()} had changed ${c.r.pick(["color", "shape", "its mind", "owners"])}.`,
  (c) => `Somewhere beyond ${c.place}, a ${c.r.pick(OBJECTS)} began to ring.`,
  (c) => `${c.friend} swore the ${c.r.pick(OBJECTS)} had belonged to ${c.villain} once.`,
  (c) => `${c.villain} wanted the ${c.r.pick(OBJECTS)}, and wanted it ${c.r.pick(["quietly", "tonight", "more than sleep", "for reasons of its own"])}.`,
  (c) => `They ${c.r.pick(["argued", "whispered", "bargained", "waited"])} until the ${c.r.pick(ADJ)} light faded from ${c.place}.`,
  (c) => `Then, without ceremony, ${c.hero} ${c.r.pick(VERBS)} and stepped through.`,
];

function storyParagraph(c) {
  const n = c.r.int(3, 7);
  const out = [];
  for (let i = 0; i < n; i++) out.push(c.r.pick(SENTENCES)(c));
  return out.join(" ");
}

function storyCast(r) {
  return {
    r,
    hero: `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`,
    friend: r.pick(FIRST_NAMES),
    villain: `${r.pick(["Madame", "Lord", "Doctor", "The Warden"])} ${r.pick(LAST_NAMES)}`,
    place: r.pick(PLACES),
  };
}

export function storyTitle(r) {
  return r.weighted([
    [() => `The ${r.pick(ADJ)} ${r.pick(NOUNS)}`, 3],
    [() => `${r.pick(NOUNS)} of ${r.pick(PLACES).replace(/^(the|a|an) /, "")}`, 2],
    [() => `What ${r.pick(FIRST_NAMES)} Found in ${cap(r.pick(PLACES))}`, 1],
  ])();
}

export function storyDocument(r, target, title = storyTitle(r)) {
  const c = storyCast(r);
  const parts = [`# ${title}`, `> *${c.r.pick(SPEECH)}.* — ${c.friend}`];
  let size = parts[0].length + parts[1].length;
  let chapter = 0;
  while (size < target) {
    if (chapter === 0 || r.chance(0.12)) {
      chapter++;
      const heading = `## Chapter ${chapter}: ${cap(r.pick(ADJ))} ${r.pick(NOUNS)}`;
      parts.push(heading);
      size += heading.length;
      if (r.chance(0.3)) c.place = r.pick(PLACES);
    }
    const block = r.chance(0.04) ? "* * *" : storyParagraph(c);
    parts.push(block);
    size += block.length + 2;
  }
  parts.push(`*The end of ${title.toLowerCase()}.*`);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Generated code (including test code)
// ---------------------------------------------------------------------------------------------------------------------

const ID_WORDS = ["user", "note", "group", "index", "token", "cache", "queue", "parse", "render", "buffer", "stream", "config", "event", "node", "tree", "range", "match", "value", "result", "state", "item", "batch", "order", "price", "total", "count", "path", "file", "query", "row"];

const camel = (r, words = r.int(2, 3)) => Array.from({ length: words }, (_, i) => (i === 0 ? r.pick(ID_WORDS) : cap(r.pick(ID_WORDS)))).join("");
const snake = (r, words = r.int(2, 3)) => Array.from({ length: words }, () => r.pick(ID_WORDS)).join("_");
const pascal = (r, words = r.int(1, 2)) => Array.from({ length: words }, () => cap(r.pick(ID_WORDS))).join("");

const CODE = {
  ts: [
    (r) => {
      const name = camel(r), a = camel(r), b = camel(r);
      return `export function ${name}(${a}: number, ${b} = ${r.int(1, 99)}): number {\n  if (!Number.isFinite(${a})) throw new RangeError("${a} must be finite");\n  let total = 0;\n  for (let i = 0; i < ${a}; i++) {\n    total += (i * ${b}) % ${r.int(3, 17)};\n  }\n  return total;\n}`;
    },
    (r) => {
      const type = pascal(r);
      return `export type ${type} = {\n  id: number;\n  ${camel(r)}: string;\n  ${camel(r)}?: ${pascal(r)}[];\n  readonly ${camel(r)}: Map<string, number>;\n};\n\nexport const DEFAULT_${snake(r).toUpperCase()}: ${type} = {\n  id: ${r.int(1, 999)},\n  ${camel(r)}: "${r.pick(ID_WORDS)}",\n  ${camel(r)}: new Map(),\n};`;
    },
    (r) => {
      const cls = pascal(r, 2), m = camel(r), f = camel(r);
      return `export class ${cls} {\n  private readonly ${f} = new Map<number, string>();\n\n  ${m}(key: number): string | undefined {\n    return this.${f}.get(key);\n  }\n\n  async ${camel(r)}(keys: number[]): Promise<string[]> {\n    const found = await Promise.all(keys.map((k) => Promise.resolve(this.${m}(k) ?? "")));\n    return found.filter((s) => s !== "");\n  }\n}`;
    },
    // Test code.
    (r) => {
      const fn = camel(r);
      return `import { describe, expect, it } from "vitest";\nimport { ${fn} } from "./${fn}";\n\ndescribe("${fn}", () => {\n  it("returns ${r.int(0, 50)} for the empty case", () => {\n    expect(${fn}(0)).toBe(0);\n  });\n\n  it.each([[1, ${r.int(1, 9)}], [2, ${r.int(1, 9)}], [3, ${r.int(1, 9)}]])("handles %i", (input, expected) => {\n    expect(${fn}(input)).toBeGreaterThanOrEqual(expected - ${r.int(1, 5)});\n  });\n\n  it("rejects NaN", () => {\n    expect(() => ${fn}(Number.NaN)).toThrow(RangeError);\n  });\n});`;
    },
  ],
  tsx: [
    (r) => {
      const comp = pascal(r, 2), prop = camel(r);
      return `export function ${comp}({ ${prop}, onSelect }: { ${prop}: string[]; onSelect: (i: number) => void }) {\n  const [active, setActive] = useState(0);\n  return (\n    <ul role="listbox" className="flex flex-col gap-${r.int(1, 4)}">\n      {${prop}.map((label, i) => (\n        <li key={label} aria-selected={i === active} onClick={() => { setActive(i); onSelect(i); }}>\n          {label}\n        </li>\n      ))}\n    </ul>\n  );\n}`;
    },
  ],
  python: [
    (r) => {
      const fn = snake(r), a = snake(r, 1), b = snake(r, 1);
      return `def ${fn}(${a}: list[int], ${b}: int = ${r.int(1, 20)}) -> dict[str, int]:\n    """Group ${a} by remainder of ${b}."""\n    out: dict[str, int] = {}\n    for value in ${a}:\n        key = f"bucket_{value % ${b}}"\n        out[key] = out.get(key, 0) + value\n    return out`;
    },
    (r) => {
      const cls = pascal(r, 2);
      return `@dataclass\nclass ${cls}:\n    ${snake(r, 1)}: str\n    ${snake(r, 1)}: int = ${r.int(0, 9)}\n    ${snake(r, 1)}: list[str] = field(default_factory=list)\n\n    def ${snake(r)}(self) -> str:\n        return ", ".join(sorted(self.${snake(r, 1)}))`;
    },
    (r) => {
      const fn = snake(r);
      return `import pytest\n\nfrom app.${snake(r, 1)} import ${fn}\n\n\n@pytest.mark.parametrize("value,expected", [(${r.int(0, 9)}, ${r.int(0, 9)}), (${r.int(0, 9)}, ${r.int(0, 9)}), (${r.int(0, 9)}, ${r.int(0, 9)})])\ndef test_${fn}(value, expected):\n    assert ${fn}([value], ${r.int(1, 5)}) is not None\n\n\ndef test_${fn}_empty():\n    assert ${fn}([]) == {}`;
    },
  ],
  go: [
    (r) => {
      const fn = pascal(r, 2);
      return `func ${fn}(items []int, limit int) (int, error) {\n\tif limit <= 0 {\n\t\treturn 0, fmt.Errorf("limit must be positive, got %d", limit)\n\t}\n\tsum := 0\n\tfor _, item := range items {\n\t\tif item > limit {\n\t\t\tcontinue\n\t\t}\n\t\tsum += item\n\t}\n\treturn sum, nil\n}`;
    },
    (r) => {
      const fn = pascal(r, 2);
      return `func Test${fn}(t *testing.T) {\n\tcases := []struct {\n\t\tname string\n\t\tin   []int\n\t\twant int\n\t}{\n\t\t{"empty", nil, 0},\n\t\t{"one", []int{${r.int(1, 9)}}, ${r.int(1, 9)}},\n\t}\n\tfor _, tc := range cases {\n\t\tt.Run(tc.name, func(t *testing.T) {\n\t\t\tgot, _ := ${fn}(tc.in, ${r.int(5, 50)})\n\t\t\tif got < 0 {\n\t\t\t\tt.Fatalf("got %d, want >= 0 (%d)", got, tc.want)\n\t\t\t}\n\t\t})\n\t}\n}`;
    },
  ],
  rust: [
    (r) => {
      const fn = snake(r);
      return `pub fn ${fn}(input: &[u32], modulus: u32) -> Option<u32> {\n    if modulus == 0 {\n        return None;\n    }\n    input.iter().map(|v| v % modulus).max()\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn ${fn}_handles_zero() {\n        assert_eq!(${fn}(&[${r.int(1, 9)}, ${r.int(1, 9)}], 0), None);\n    }\n}`;
    },
  ],
  sql: [
    (r) => `SELECT ${snake(r, 1)}.id, ${snake(r, 1)}.${snake(r)}, COUNT(*) AS total\nFROM ${snake(r)} AS ${snake(r, 1)}\nJOIN ${snake(r)} ON ${snake(r)}.${snake(r, 1)}_id = ${snake(r, 1)}.id\nWHERE ${snake(r, 1)}.created_at >= '2026-0${r.int(1, 9)}-01'\nGROUP BY 1, 2\nHAVING COUNT(*) > ${r.int(1, 20)}\nORDER BY total DESC\nLIMIT ${r.int(10, 500)};`,
  ],
  bash: [
    (r) => `#!/usr/bin/env bash\nset -euo pipefail\n\n${snake(r).toUpperCase()}="\${1:-${r.pick(ID_WORDS)}}"\nfor f in ./${r.pick(ID_WORDS)}/*.${r.pick(["md", "json", "log", "txt"])}; do\n  [ -e "$f" ] || continue\n  echo "processing $f ($(wc -c < "$f") bytes)"\ndone`,
  ],
  json: [
    (r) => JSON.stringify({ name: snake(r), version: `${r.int(0, 3)}.${r.int(0, 20)}.${r.int(0, 20)}`, private: r.chance(0.5), scripts: { build: "tsc -p .", test: "vitest run" }, items: Array.from({ length: r.int(2, 6) }, () => ({ id: r.int(1, 9999), label: camel(r), tags: [r.pick(ID_WORDS), r.pick(ID_WORDS)] })) }, null, 2),
  ],
  yaml: [
    (r) => `name: ${snake(r)}\non:\n  push:\n    branches: [main]\njobs:\n  ${snake(r, 1)}:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${r.pick(ID_WORDS)} ${r.int(1, 99)}"\n      - run: pnpm test -- --shard=${r.int(1, 4)}/4`,
  ],
  css: [
    (r) => `.${r.pick(ID_WORDS)}-${r.pick(ID_WORDS)} {\n  display: grid;\n  grid-template-columns: repeat(${r.int(2, 6)}, minmax(0, 1fr));\n  gap: ${r.int(2, 24)}px;\n  color: oklch(${(r.next() * 0.6 + 0.3).toFixed(2)} 0.${r.int(1, 20)} ${r.int(0, 360)});\n}\n\n.${r.pick(ID_WORDS)}:hover > .${r.pick(ID_WORDS)} {\n  transform: translateY(-${r.int(1, 6)}px);\n}`,
  ],
};

const LANGS = Object.keys(CODE);

export function codeSnippet(r, lang = r.pick(LANGS)) {
  return { lang, code: r.pick(CODE[lang])(r) };
}

export function codeFence(r, lang) {
  const { lang: l, code } = codeSnippet(r, lang);
  return `\`\`\`${l}\n${code}\n\`\`\``;
}

/** A note of explanation interleaved with generated code blocks, about `target` characters long. */
export function codeDocument(r, target) {
  const parts = [`# ${cap(r.pick(ID_WORDS))} ${r.pick(["notes", "snippets", "tests", "scratchpad", "walkthrough", "cheatsheet"])}`];
  let size = parts[0].length;
  while (size < target) {
    const block = r.weighted([
      [() => `## ${cap(camel(r))}`, 2],
      [() => loremParagraph(r, r.int(1, 3)), 3],
      [() => codeFence(r), 8],
      [() => `Run it with \`${r.pick(["pnpm test", "cargo test", "go test ./...", "pytest -q", "make check"])}\` and compare against \`${camel(r)}\`.`, 2],
      [() => loremList(r), 1],
    ])();
    parts.push(block);
    size += block.length + 2;
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// MDX notes (the components a note may use: Info, Warning, Mark, Toc, Footnotes, Repo, YouTube, Chart)
// ---------------------------------------------------------------------------------------------------------------------

const MARK_COLORS = ["yellow", "green", "blue", "pink", "orange", "purple"];
const REPOS = ["https://github.com/meddlin/composition", "https://gitlab.com/gitlab-org/gitlab", "https://codeberg.org/forgejo/forgejo", "git@git.example.com:team/tool.git", "https://github.com/vercel/next.js"];
const YOUTUBE_IDS = ["dQw4w9WgXcQ", "jNQXAC9IVRw", "9bZkp7q19f0", "aqz-KE-bpKQ"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function chartBlock(r, rows = r.int(4, 24)) {
  const type = r.pick(["bar", "line", "area", "pie"]);
  const series = type === "pie" ? 1 : r.int(1, 3);
  const names = ["sales", "costs", "returns"].slice(0, series);
  const header = ["label", ...names].join(",");
  const lines = [];
  for (let i = 0; i < rows; i++) {
    lines.push([i < 12 ? MONTHS[i] : `${MONTHS[i % 12]} ${Math.floor(i / 12) + 1}`, ...names.map(() => r.int(0, 500))].join(","));
  }
  return `<Chart type="${type}" x="label" y="${names.join(",")}" title="${cap(r.pick(ID_WORDS))} by month">\n\n\`\`\`csv\n${header}\n${lines.join("\n")}\n\`\`\`\n\n</Chart>`;
}

function infoBlock(r, tag = r.pick(["Info", "Warning"])) {
  return `<${tag}>\n\n${decorate(r, loremSentence(r, r.int(8, 20)))}\n\n${loremList(r, false)}\n\n</${tag}>`;
}

function markedParagraph(r) {
  const words = loremParagraph(r, r.int(2, 4)).split(" ");
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (r.chance(0.05) && i + 2 < words.length) {
      out.push(`<Mark color="${r.pick(MARK_COLORS)}">${words[i]} ${words[i + 1]}</Mark>`);
      i++;
    } else out.push(words[i]);
  }
  return out.join(" ");
}

/** An MDX note, `target` characters long, using a random selection of the components. */
export function mdxDocument(r, target, { youtube = false, links = [] } = {}) {
  const parts = [`# ${loremTitle(r)}`];
  if (target > 2500 && r.chance(0.7)) parts.push(r.chance(0.5) ? "<Toc />" : `<Toc maxDepth="${r.int(1, 3)}" />`);
  let size = 0;
  const footnotes = [];
  while (size < target) {
    const block = r.weighted([
      [() => `## ${loremTitle(r)}`, 2],
      [() => markedParagraph(r), 6],
      [() => infoBlock(r), 2],
      [() => chartBlock(r), 1],
      [() => `<Repo url="${r.pick(REPOS)}" />`, 0.6],
      [() => (youtube ? `<YouTube url="${r.pick(YOUTUBE_IDS)}" start="${r.int(0, 3)}:${String(r.int(0, 59)).padStart(2, "0")}" />` : loremParagraph(r)), 0.6],
      [() => {
        const label = String(footnotes.length + 1);
        footnotes.push(`[^${label}]: ${loremSentence(r, r.int(5, 12))}`);
        return `${loremSentence(r, r.int(6, 12)).slice(0, -1)}[^${label}].`;
      }, 1],
      [() => (links.length ? `See also [${loremTitle(r)}](note:${r.pick(links)}).` : loremParagraph(r)), 1],
      [() => codeFence(r), 1],
    ])();
    parts.push(block);
    size += block.length + 2;
  }
  if (footnotes.length) parts.push(footnotes.join("\n"), "<Footnotes />");
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Everyday notes: tasks, meetings, journals, with links to other notes
// ---------------------------------------------------------------------------------------------------------------------

export function everydayDocument(r, target, links = []) {
  const kind = r.pick(["tasks", "meeting", "journal"]);
  const parts = [];
  if (kind === "tasks") {
    parts.push(`# Tasks: ${loremTitle(r)}`);
    let size = 0;
    while (size < target) {
      const n = r.int(3, 10);
      const group = [`## ${cap(r.pick(ID_WORDS))} ${r.pick(["backlog", "this week", "someday", "blocked"])}`];
      for (let i = 0; i < n; i++) group.push(`- [${r.chance(0.4) ? "x" : " "}] ${decorate(r, loremSentence(r, r.int(3, 9)))}`);
      const text = group.join("\n");
      parts.push(text);
      size += text.length + 2;
    }
  } else if (kind === "meeting") {
    parts.push(`# Meeting: ${loremTitle(r)}`, `**Attendees:** ${Array.from({ length: r.int(2, 6) }, () => r.pick(FIRST_NAMES)).join(", ")}`);
    let size = parts[0].length;
    while (size < target) {
      const text = [`## ${loremTitle(r)}`, loremParagraph(r, 2), loremList(r, false), links.length && r.chance(0.5) ? `Follow-up: [${loremTitle(r)}](note:${r.pick(links)})` : ""].filter(Boolean).join("\n\n");
      parts.push(text);
      size += text.length + 2;
    }
  } else {
    parts.push(`# ${r.pick(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])} journal`);
    let size = 0;
    while (size < target) {
      const text = r.chance(0.2) ? loremQuote(r) : loremParagraph(r, r.int(3, 7));
      parts.push(text);
      size += text.length + 2;
    }
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Edge cases: the shapes most likely to break an editor or a list. The same set goes in every database.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `{ title, body, tags }` for each case. Titles are prefixed `EDGE:` so they sort and search together; the heavy ones
 * are tagged `huge`.
 */
export function edgeCases(r) {
  const long = (n, line) => Array.from({ length: n }, (_, i) => line(i)).join("\n");
  const cases = [];
  const add = (title, body, tags = []) => cases.push({ title: `EDGE: ${title}`, body, tags: ["edge-case", ...tags] });

  add("empty body", "");
  add("only whitespace", "   \n\n\t\n   \n");
  add("single character", "x");
  add("one huge line (200,000 chars, no newline)", loremParagraph(r, 4).repeat(Math.ceil(200_000 / 500)).slice(0, 200_000), ["huge-line"]);
  add("one unbroken token (100,000 chars)", "a".repeat(100_000), ["huge-line"]);
  add("very long URL in prose", `Visit https://example.com/${"segment/".repeat(2000)}end?q=${"x".repeat(5000)} for details.\n\n${loremParagraph(r)}`);
  add("20,000 short lines", long(20_000, (i) => `line ${i + 1}: ${r.pick(LOREM_WORDS)}`), ["many-lines"]);
  add("5,000 headings (Toc stress)", `<Toc />\n\n${long(5_000, (i) => `## Heading ${i + 1} ${r.pick(LOREM_WORDS)}\n\n${loremSentence(r)}\n`)}`, ["many-headings", "mdx"]);
  add("2,000-row table", `| id | name | value | note |\n| --- | --- | --- | --- |\n${long(2_000, (i) => `| ${i} | ${camel(r)} | ${r.int(0, 99999)} | ${r.pick(LOREM_WORDS)} |`)}`, ["table"]);
  add("table with 40 columns", `| ${Array.from({ length: 40 }, (_, i) => `c${i}`).join(" | ")} |\n| ${Array.from({ length: 40 }, () => "---").join(" | ")} |\n${long(30, () => `| ${Array.from({ length: 40 }, () => r.int(0, 999)).join(" | ")} |`)}`, ["table"]);
  add("100-level nested list", long(100, (i) => `${"  ".repeat(i)}- level ${i + 1} ${r.pick(LOREM_WORDS)}`), ["nesting"]);
  add("100-level nested blockquote", `${">".repeat(100)} deep ${loremSentence(r)}`, ["nesting"]);
  add("3,000 task items", long(3_000, (i) => `- [${i % 3 === 0 ? "x" : " "}] task ${i + 1} ${r.pick(LOREM_WORDS)}`), ["many-lines"]);
  add("one 5 MB-class code block", `\`\`\`ts\n${long(40_000, () => `export const ${camel(r)}${r.int(0, 99999)} = ${r.int(0, 99999)};`)}\n\`\`\``, ["huge", "code"]);
  add("300 small code blocks", long(300, () => `${codeFence(r)}\n`), ["code", "many-blocks"]);
  add("200 inline Mark highlights", `${long(200, () => `<Mark color="${r.pick(MARK_COLORS)}">${r.pick(LOREM_WORDS)} ${r.pick(LOREM_WORDS)}</Mark> ${loremSentence(r, 8)}`)}`, ["mdx", "marks"]);
  add("60 charts on one note", long(60, () => `${chartBlock(r, 12)}\n`), ["mdx", "charts"]);
  add("one chart with 500 rows (the limit)", chartBlock(r, 500), ["mdx", "charts"]);
  add("one chart with 700 rows (over the limit)", chartBlock(r, 700), ["mdx", "charts"]);
  add("300 footnotes", `${long(300, (i) => `Claim ${i + 1}[^${i + 1}] ${loremSentence(r, 6)}`)}\n\n${long(300, (i) => `[^${i + 1}]: ${loremSentence(r, 8)}`)}\n\n<Footnotes />`, ["mdx", "footnotes"]);
  add("unknown MDX component", `# Rejected\n\n<Banner>\n\nThis tag is not allowed.\n\n</Banner>\n\n<Info>\n\nbut this one is.\n\n</Info>`, ["mdx", "invalid"]);
  add("MDX expressions and import", `import x from "y"\n\n# Rejected\n\n<Info title={1 + 1}>\n\n{props.value}\n\n</Info>`, ["mdx", "invalid"]);
  add("stray < and { in plain prose", `a < b && c > d, and {braces} and <html> tags and <3 hearts.\n\n${loremParagraph(r)}`, ["invalid"]);
  add("unclosed MDX tags", `<Info>\n\nnever closed\n\n<Warning>\n\n${loremParagraph(r)}`, ["mdx", "invalid"]);
  add("unterminated code fence", `# Fence\n\n\`\`\`ts\nconst x = 1;\n\n${loremParagraph(r)}\n\n${loremParagraph(r)}`, ["code", "invalid"]);
  add("unicode: emoji, CJK, RTL, combining marks", `# Unicode 🌍🚀\n\n日本語のテキストです。中文文本。한국어 텍스트.\n\nمرحبا بالعالم — שלום עולם\n\né ä ñ Z͑ͫ̓ͪ̂ͫ̽͏̴̙̤̞͉͚̯̞̠͍A̴̵̜̰͔ͫ͗͢L̠ͨͧͩ͘G̴̻͈͍͔̹̑͗̎̅͛́Ǫ̵̹̻̝̳͂̌̌͘!\n\n👨‍👩‍👧‍👦 🏳️‍🌈 🇯🇵 zero​width​spaces and nbsp and   line separator   paragraph separator.\n\n${loremParagraph(r)}`, ["unicode"]);
  add("unicode: 20,000 emoji", "😀🎉🔥✨".repeat(5_000), ["unicode", "huge-line"]);
  add("CRLF line endings", long(500, (i) => `Line ${i + 1} ${r.pick(LOREM_WORDS)}`).replace(/\n/g, "\r\n"), ["line-endings"]);
  add("tabs and trailing spaces", long(300, (i) => `\t${"\t".repeat(i % 4)}item ${i}   `), ["whitespace"]);
  add("HTML and script tags in prose", `<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<iframe src="https://example.com"></iframe>\n\n[click](javascript:alert(1))\n\n[ok](note:1)`, ["security"]);
  add("links to missing and invalid notes", `[gone](note:99999999)\n\n[zero](note:0)\n\n[negative](note:-1)\n\n[overflow](note:${"9".repeat(40)})\n\n![missing](app_data/nope-0123456789ab.png)`, ["links"]);
  add("frontmatter lookalike mid-note", `# Title\n\n---\ntitle: not frontmatter\n---\n\n${loremParagraph(r)}`, ["frontmatter"]);
  add("nested/duplicate YAML keys in body", `---\nthis: is\n---\n\nbody ${loremParagraph(r)}`, ["frontmatter"]);
  add("[[ link trigger and / snippet text", `Typing [[ here or / there or < everywhere.\n\n[[unclosed link\n\n${loremParagraph(r)}`, ["editor"]);
  add("repeated title", loremParagraph(r), ["title"]);
  add("repeated title", loremParagraph(r), ["title"]);
  cases.push({ title: "", body: `A note whose title is empty (shown as "Untitled").\n\n${loremParagraph(r)}`, tags: ["edge-case", "title"] });
  cases.push({ title: "t".repeat(600), body: loremParagraph(r), tags: ["edge-case", "title"] });
  cases.push({ title: "   leading and trailing   ", body: loremParagraph(r), tags: ["edge-case", "title"] });
  cases.push({ title: "Title: with \"quotes\", colons: and # hashes & [brackets] {braces}", body: loremParagraph(r), tags: ["edge-case", "title"] });
  cases.push({ title: "Emoji 🚀 and CJK 日本語 title", body: loremParagraph(r), tags: ["edge-case", "title", "unicode"] });

  const sizes = [200_000, 1_000_000, 3_000_000];
  sizes.forEach((size, i) => {
    add(`prose document ~${Math.round(size / 1000)} KB`, loremDocument(r, size), ["huge", "prose"]);
    add(`story ~${Math.round(size / 1000)} KB`, storyDocument(r, size), ["huge", "story"]);
    add(`code document ~${Math.round(size / 1000)} KB`, codeDocument(r, size), ["huge", "code"]);
    if (i < 2) add(`MDX document ~${Math.round(size / 1000)} KB`, mdxDocument(r, size), ["huge", "mdx"]);
  });
  return cases;
}

export { LOREM_WORDS, camel, cap };
