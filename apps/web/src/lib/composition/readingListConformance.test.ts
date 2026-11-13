import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conformancePath, UPDATING_FIXTURES } from "./__fixtures__/conformance";
import { cleanReadingTitle, hostLabel, normalizeReadingUrl, readingItemLabel, sortReadingItems } from "./readingList";
import { MAX_READING_TITLE_LENGTH, MAX_READING_URL_LENGTH, type ReadingItem } from "./readingListApi";
import { parseWebSettings } from "./webSettings";

// Meilisearch isn't running in tests; opening the database does not need it, but the service's imports reach for it.
vi.mock("./searchIndex", () => ({
  indexNote: vi.fn(async () => {}),
  deleteNoteFromIndex: vi.fn(async () => {}),
  searchNoteIds: vi.fn(async () => []),
  unavailableMessage: () => "Search is unavailable.",
}));

/**
 * The Reading List is ported to the iPad (`CompositionCore/ReadingList`), so its rules must agree exactly with the desktop's.
 * This test pins what the Swift side replays, `fixtures/conformance/reading-list.json` (see fixtures/conformance/README.md):
 *
 *   constants    the two length limits, and whether the plugin is on before anyone chooses
 *   urls         `normalizeReadingUrl` over typed and pasted links: the stored address, or the desktop's words for why not
 *   hostLabels   `hostLabel`: what a link is called until its page has said
 *   titles       `cleanReadingTitle`: a page title as it is stored
 *   labels       `readingItemLabel`: the title, else the host
 *   sorting      `sortReadingItems`: unread first, then read, each oldest first
 *   plugins      `parseWebSettings(...).plugins["reading-list"]`: whether a settings file has the Reading List on
 *   script       operations through the real `readingListService` on a fresh database, with a set clock: what each returned
 *                (or the error it threw) and every row afterwards
 *
 * A change to the TypeScript behaviour fails here until the fixture is regenerated (`UPDATE_FIXTURES=1 pnpm exec vitest run
 * src/lib/composition/readingListConformance.test.ts`), which is the prompt to update the Swift side too.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function pretty(value: Json, indent = ""): string {
  const flat = JSON.stringify(value);
  if (flat.length + indent.length <= 150 || value === null || typeof value !== "object") return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((item) => `${inner}${pretty(item, inner)}`).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`);
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

function format(fixture: Json): string {
  const object = fixture as { [key: string]: Json };
  const sections = Object.entries(object).map(([key, value]) => `  ${JSON.stringify(key)}: ${pretty(value, "  ")}`);
  return `{\n${sections.join(",\n")}\n}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Inputs

const longPath = (total: number) => `https://example.com/${"a".repeat(total - "https://example.com/".length)}`;

/** Links as people type and paste them, and the odd ones a URL parser has opinions about. */
const URL_INPUTS: string[] = [
  // Ordinary links
  "https://example.com/article",
  "http://example.com/article",
  "https://www.nytimes.com/2026/11/13/technology/article.html?smid=nytcore-ios-share&referringSource=articleShare",
  "https://medium.com/@someone/a-post-title-123abc",
  "news.ycombinator.com/item?id=1",
  "https://example.com/path;params",
  "https://a.b-c.d_e/",
  // No scheme, so https:// is added
  "example.com",
  "example.com/a/b?c=d",
  "www.example.com/path",
  "Example.COM/Path",
  "localhost",
  "localhost:3000/notes",
  "127.0.0.1:8080/x",
  "example.com:443",
  "example.com:80",
  "a",
  "1",
  "//example.com/a",
  "/relative/path",
  "?q=1",
  "#frag",
  // Spaces, tabs and new lines
  "  https://example.com/a#top  ",
  " https://example.com/ ",
  "﻿example.com",
  " example.com ",
  "　example.com　",
  "\u0085example.com",
  "\u0001example.com",
  "example.com\u0001",
  "https://exam\tple.com/a\nb",
  "https://example.com/a\r\nb",
  "",
  "   ",
  "\t\n",
  // Case, ports and slashes
  "HTTPS://EXAMPLE.COM/Path",
  "HTTP://example.com:80",
  "https://example.com:443/a",
  "https://example.com:443",
  "http://example.com:80/a",
  "https://example.com:8443/a",
  "http://example.com:443/a",
  "https://example.com:0443/a",
  "https://example.com:/a",
  "https://example.com:65535/",
  "https://example.com:65536/",
  "https://example.com:12a/",
  "https:///example.com/a",
  "https:example.com",
  "https://example.com\\a\\b",
  "https://example.com/a\\b?c\\d",
  "https://example.com./",
  "https://EXAMPLE.com..",
  // Fragments, queries and paths
  "https://example.com/a#",
  "https://example.com/#section",
  "https://example.com?",
  "https://example.com/?a=1#frag",
  "https://example.com/p?x#",
  "https://example.com/a?b#c#d",
  "https://example.com/a b c",
  // No `^` in a path here: Node 22 (CI's unit tests) leaves it as it is, and Node 24 and 26 write it as %5E, so the answer depends on the
  // runtime that makes this file. The Swift side writes %5E, the newer answer, and pins it in ReadingListTests.
  'https://example.com/a"b<c>d`e{f}g|h[j]k',
  "https://example.com/q?a=b c&d=\"e\"&f='g'&h=<i>&j=`k`&l={m}",
  "https://example.com/café?q=café",
  "https://example.com/\u{1f600}?e=\u{1f600}",
  "https://example.com/%7Euser/%2e%2E/x",
  "https://EXAMPLE.com/%7e",
  "https://example.com/a%2Fb",
  "https://example.com/a?q=%zz",
  "https://example.com/%",
  "https://example.com/a/./b/../c",
  "https://example.com/a/..",
  "https://example.com/a/.",
  "https://example.com/a/%2e",
  "https://example.com/a/%2E%2e/b",
  "https://example.com/../../a",
  "https://example.com/a//b",
  "https://example.com/a\u0000b",
  "https://example.com/a\u007fb",
  "https://example.com/a\u0080b",
  // Who is asking: user names and passwords
  "https://user@example.com/",
  "https://user:pass@example.com/",
  "https://:pass@example.com/",
  "https://@example.com/",
  "https://:@example.com/",
  "https://example.com@evil.com/",
  "https://a@b@example.com/",
  "https://example.com/a@b",
  // Numbers for hosts
  "http://192.168.1.10/a",
  "http://0x7f.1/",
  "http://0177.0.0.1/",
  "http://2130706433/",
  "http://1.2.3/",
  "http://0x/",
  "http://0x7F000001/",
  "http://256.1.1.1/",
  "http://1.2.3.4.5/",
  "http://1.2.3.4./",
  "http://1.2.3.256/",
  "http://1.2.65536/",
  "http://4294967295/",
  "http://4294967296/",
  "http://09.1.1.1/",
  "http://example.1/",
  "http://1.example/",
  "http://0x1g/",
  "https://[::1]/",
  "https://[2001:DB8::1]:8080/a",
  "https://[2001:db8:0:0:1:0:0:1]/",
  "https://[2001:0db8:0000:0000:0000:0000:0000:0001]/",
  "https://[::ffff:192.168.0.1]/",
  "https://[1:2:3:4:5:6:7:8]/",
  "https://[1:0:0:4:0:0:0:8]/",
  "https://[0:0:0:0:0:0:0:0]/",
  "http://[::1]:80/",
  "https://[::1/",
  "https://[gg::1]/",
  "https://[1:2:3:4:5:6:7:8:9]/",
  "https://[::1::2]/",
  "https://[::256.0.0.1]/",
  // Names that are not plain ASCII, or not allowed
  "https://exa mple.com/",
  "https://exa<mple.com/",
  "https://exa^mple.com/",
  "https://exa|mple.com/",
  "https://%65xample.com/",
  "https://exa%20mple.com/",
  "https://ex%ample.com/",
  "https://café.com/x",
  "bücher.example",
  "https://例え.jp/パス",
  "例え。jp",
  "ＥＸＡＭＰＬＥ.com",
  "faß.de",
  "ПРИМЕР.рф",
  "https://xn--caf-dma.com/",
  "https://XN--CAF-DMA.com/",
  "https://a‍b.com",
  "https://☕.us",
  // Schemes that are not the web
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  " javascript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,hi",
  "file:///etc/passwd",
  "blob:https://a.com/x",
  "about:blank",
  "mailto:a@b.com",
  "tel:+15555555",
  "vbscript:x",
  "view-source:https://a.com",
  "chrome://settings",
  "devtools://x",
  "app://composition/x",
  "ftp://example.com/file",
  "ws://example.com/",
  "wss://example.com:443/",
  "foo://bar/",
  "foo://bar baz/",
  "foo://bar:x/",
  "foo:bar",
  "ftp://",
  "http://",
  "https://",
  "https://:443/",
  // Length
  longPath(MAX_READING_URL_LENGTH),
  longPath(MAX_READING_URL_LENGTH + 1),
  `  ${longPath(MAX_READING_URL_LENGTH)}  `,
  `https://example.com/${"é".repeat(MAX_READING_URL_LENGTH - "https://example.com/".length)}`,
  `https://example.com/${"\u{1f600}".repeat(1100)}`,
];

const HOST_LABEL_INPUTS = [
  "https://www.example.com/",
  "https://example.com/a",
  "https://www.www.example.com/",
  "https://wwwexample.com/",
  "https://WWW.Example.com/",
  "http://localhost:3000/",
  "https://www./",
  "https://www.xn--caf-dma.com/",
  "https://[::1]/",
  "https://[2001:db8::1]:8080/a",
  "https://1.2.3.4/",
  "https://example.com:8443/",
  "not a link",
  "",
  "https://user@example.com/",
  "www.example.com",
  "https://café.com/x",
];

const TITLE_INPUTS = [
  "A post",
  "  Spaced   out \n title\t",
  "",
  "   ",
  "\n\t\r",
  "a  b",
  "em space",
  "ideographic　space",
  "line separator",
  "next\u0085line",
  "zero​width",
  "byte﻿order",
  "vertical\u000btab",
  "Ünïcödé — title",
  "\u{1f600} smile \u{1f600}",
  "a".repeat(MAX_READING_TITLE_LENGTH),
  "a".repeat(MAX_READING_TITLE_LENGTH + 1),
  `${"a".repeat(MAX_READING_TITLE_LENGTH - 1)}  b`,
  `  ${"a".repeat(MAX_READING_TITLE_LENGTH)}`,
  `${"word ".repeat(80)}`,
];

const LABEL_INPUTS: { url: string; title: string }[] = [
  { url: "https://www.example.com/a", title: "" },
  { url: "https://example.com/a", title: "A post" },
  { url: "https://www./", title: "" },
  { url: "https://example.com/a", title: " " },
];

/** Deterministic pseudo-random numbers, so the fixture is the same on every machine. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function sortingInputs(): { id: number; read: boolean }[][] {
  const next = random(20261113);
  const lists: { id: number; read: boolean }[][] = [[], [{ id: 1, read: true }], [{ id: 2, read: false }, { id: 1, read: false }]];
  for (let n = 0; n < 12; n += 1) {
    const size = 2 + Math.floor(next() * 9);
    const ids = new Set<number>();
    while (ids.size < size) ids.add(1 + Math.floor(next() * 40));
    lists.push([...ids].map((id) => ({ id, read: next() < 0.5 })));
  }
  return lists;
}

/** What `plugins` in a settings file can hold, from nothing at all to the wrong types. `undefined` is a file without the key. */
const PLUGIN_VALUES: { plugins?: Json }[] = [
  {},
  { plugins: null },
  { plugins: {} },
  { plugins: { "reading-list": true } },
  { plugins: { "reading-list": false } },
  { plugins: { "reading-list": "true" } },
  { plugins: { "reading-list": 1 } },
  { plugins: { "reading-list": null } },
  { plugins: { todo: true, rss: true } },
  { plugins: { todo: false, "reading-list": true, rss: false, contacts: true, unknown: true } },
  { plugins: [] },
  { plugins: [true] },
  { plugins: "reading-list" },
  { plugins: 5 },
  { plugins: true },
];

type Step =
  | { op: "list" }
  | { op: "add"; input: string }
  | { op: "setTitle"; id: number; title: string }
  | { op: "setRead"; id: number; read: boolean }
  | { op: "delete"; id: number };

/** One session with the Reading List, as the service sees it: each step a minute after the last. */
const SCRIPT: Step[] = [
  { op: "list" },
  { op: "add", input: "  example.com/a#top " },
  { op: "add", input: "https://example.org/b" },
  { op: "add", input: "javascript:alert(1)" },
  { op: "add", input: "" },
  { op: "add", input: "https://user@example.com/" },
  { op: "add", input: "EXAMPLE.com/a#later" },
  { op: "setTitle", id: 1, title: "  A   post \n about things " },
  { op: "add", input: "https://example.com/a" },
  { op: "setTitle", id: 1, title: "A new name it does not take" },
  { op: "setTitle", id: 2, title: "   " },
  { op: "setTitle", id: 2, title: "" },
  { op: "setTitle", id: 99, title: "Nothing here" },
  { op: "setRead", id: 2, read: true },
  { op: "setRead", id: 2, read: true },
  { op: "setRead", id: 99, read: true },
  { op: "add", input: "café.example/menü?p=1" },
  { op: "setTitle", id: 3, title: `${"a".repeat(MAX_READING_TITLE_LENGTH - 1)}\u{1f600} and the rest` },
  { op: "add", input: "http://[2001:DB8::1]:80/x" },
  { op: "setTitle", id: 4, title: "x".repeat(MAX_READING_TITLE_LENGTH + 20) },
  { op: "setRead", id: 1, read: true },
  { op: "setRead", id: 1, read: false },
  { op: "list" },
  { op: "delete", id: 2 },
  { op: "delete", id: 2 },
  { op: "delete", id: 99 },
  { op: "add", input: "https://example.org/b" },
  { op: "setTitle", id: 5, title: "Back again" },
  { op: "list" },
];

const SCRIPT_START = Date.UTC(2026, 10, 13, 9, 0, 0, 7);

// ---------------------------------------------------------------------------------------------------------------------------------
// Answers

const itemJson = (item: ReadingItem): Json => ({ ...item });

async function runScript(): Promise<Json[]> {
  const service = await import("./readingListService");
  const { getDb } = await import("./db");
  const rows = () => getDb().prepare("SELECT * FROM reading_list ORDER BY id").all() as Json[];
  const out: Json[] = [];
  for (const [index, step] of SCRIPT.entries()) {
    const at = new Date(SCRIPT_START + index * 60_000);
    vi.setSystemTime(at);
    let result: Json;
    try {
      switch (step.op) {
        case "list":
          result = { items: (await service.listReadingItems()).map(itemJson) };
          break;
        case "add":
          result = { item: itemJson(await service.addReadingItem(step.input)) };
          break;
        case "setTitle":
          result = { item: itemJson(await service.setReadingItemTitle(step.id, step.title)) };
          break;
        case "setRead":
          result = { item: itemJson(await service.setReadingItemRead(step.id, step.read)) };
          break;
        case "delete":
          await service.deleteReadingItem(step.id);
          result = {};
          break;
      }
    } catch (error) {
      result = { error: (error as Error).message };
    }
    out.push({ ...(step as { [key: string]: Json }), at: at.toISOString(), result, rows: rows() });
  }
  return out;
}

async function build(): Promise<Json> {
  return {
    about:
      "The Reading List's rules as the desktop's readingList.ts, webSettings.ts and readingListService.ts answer them; the Swift ReadingListConformanceTests replay every row. Made by apps/web/src/lib/composition/readingListConformance.test.ts (UPDATE_FIXTURES=1 rewrites it).",
    constants: { maxUrlLength: MAX_READING_URL_LENGTH, maxTitleLength: MAX_READING_TITLE_LENGTH, enabledWithoutAChoice: parseWebSettings({}).plugins["reading-list"] },
    urls: URL_INPUTS.map((input): Json => {
      const { url, error } = normalizeReadingUrl(input);
      return error === undefined ? { input, url: url! } : { input, error };
    }),
    hostLabels: HOST_LABEL_INPUTS.map((url) => ({ url, label: hostLabel(url) })),
    titles: TITLE_INPUTS.map((title) => ({ title, cleaned: cleanReadingTitle(title) })),
    labels: LABEL_INPUTS.map((item) => ({ ...item, label: readingItemLabel(item) })),
    sorting: sortingInputs().map((list) => {
      const items = list.map(({ id, read }) => ({ id, read, url: "", title: "", createdAt: "", updatedAt: "" }));
      return { items: list, sorted: sortReadingItems(items).map((item) => item.id) };
    }),
    plugins: PLUGIN_VALUES.map((settings) => ({ ...settings, enabled: parseWebSettings(settings).plugins["reading-list"] })) as Json,
    script: await runScript(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-reading-list-conformance-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  const { closeDb } = await import("./db");
  closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("the Reading List fixture (fixtures/conformance/reading-list.json)", () => {
  const file = conformancePath("reading-list.json");

  it(UPDATING_FIXTURES ? "is rewritten from the TypeScript behaviour" : "is what the TypeScript makes", async () => {
    const fixture = JSON.parse(JSON.stringify(await build())) as { [key: string]: Json };
    if (UPDATING_FIXTURES) {
      fs.writeFileSync(file, format(fixture));
      return;
    }
    const committed = JSON.parse(fs.readFileSync(file, "utf8")) as { [key: string]: Json };
    for (const key of Object.keys(fixture)) expect(committed[key], `section "${key}"`).toEqual(fixture[key]);
    expect(Object.keys(committed)).toEqual(Object.keys(fixture));
  });

  it("covers what it is meant to", async () => {
    const fixture = JSON.parse(JSON.stringify(await build())) as { [key: string]: { [k: string]: Json }[] };
    const urls = fixture.urls;
    // Every one of the desktop's reasons appears, and so do links it keeps.
    for (const reason of [/Paste a link/, /too long/, /Only web links/, /does not look like a link/, /user name and password/]) {
      expect(urls.some((u) => typeof u.error === "string" && reason.test(u.error)), String(reason)).toBe(true);
    }
    expect(urls.filter((u) => typeof u.url === "string").length).toBeGreaterThan(80);
    // The script stores a title cut through the middle of a pair of UTF-16 units, as SQLite keeps it.
    expect(JSON.stringify(fixture.script)).toContain("�");
    expect(fixture.plugins.some((p) => p.enabled === true) && fixture.plugins.some((p) => p.enabled === false)).toBe(true);
  });
});
