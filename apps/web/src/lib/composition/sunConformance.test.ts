import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conformancePath, UPDATING_FIXTURES } from "./__fixtures__/conformance";
import {
  DEFAULT_SUN_HOURS,
  SUN_HOUR_KEYS,
  formatClock,
  parseClock,
  parseSunHours,
  validateSunHours,
  type SunHours,
} from "./sunHours";
import {
  DEFAULT_SUN_PAIR,
  SUN_PAIR_CHOICES,
  inkFlipLevelOf,
  isSunPairName,
} from "./sunPairs";
import {
  INK_FLIP_LEVEL,
  MS_PER_DAY,
  MS_PER_MINUTE,
  levelAtTimeOfDay,
  msOfLocalDay,
  sunThemeAttributes,
  toneForLevel,
} from "./sunSchedule";

/**
 * "Follow the sun" is a pure function of four hours the person sets by hand and the time of day on the wall clock, which the
 * Swift core ports (`CompositionCore/Sun`), so it must agree exactly. This test pins what the Swift side replays,
 * `fixtures/conformance/sun.json` (see fixtures/conformance/README.md):
 *
 *   constants, pairs, pairProbes   sunHours.ts, sunSchedule.ts and sunPairs.ts: the flip point, the defaults, the five pairs and what names them
 *   clocks, hourSets               `HH:MM` read and written, and which sets of four hours are accepted, refused (with the words) or read as the defaults
 *   levels                         the level over many sets of hours, at every edge of a fade and between
 *   tones, autoLight               toneForLevel, and the `--auto-light` text `toFixed(1)` makes
 *   wallClock                      the time of day in fourteen zones, across the days their clocks change
 *   palettes, blends               the colours of every pair as `globals.css` declares them, and its surface blend endpoints
 *
 * A change to the TypeScript behaviour fails here until the fixture is regenerated (`UPDATE_FIXTURES=1 pnpm exec vitest run
 * src/lib/composition/sunConformance.test.ts`), which is the prompt to update the Swift side too.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// ---------------------------------------------------------------------------------------------------------------------------------
// Writing the file: short things on one line, long things one entry to a line, so a change reads as a diff.

function pretty(value: Json, indent = ""): string {
  const flat = JSON.stringify(value);
  if (flat.length + indent.length <= 150 || value === null || typeof value !== "object") return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((item) => `${inner}${pretty(item, inner)}`).join(",\n")}\n${indent}]`;
  const entries = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`);
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Inputs

/** Deterministic pseudo-random numbers, so the fixture is the same on every machine. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const hoursOf = (...minutes: number[]): SunHours => {
  const [lightenFrom, lightFrom, darkenFrom, darkFrom] = minutes.map(formatClock);
  return { lightenFrom, lightFrom, darkenFrom, darkFrom };
};

/** Sets of hours that are all valid: the defaults, odd ones and a hundred drawn at random (any starting point, any gaps of a minute or more). */
function validHourSets(): SunHours[] {
  const next = random(20261112);
  const sets: SunHours[] = [
    DEFAULT_SUN_HOURS,
    hoursOf(0, 1, 2, 3),
    hoursOf(1437, 1438, 1439, 0),
    hoursOf(1439, 0, 720, 721),
    hoursOf(1140, 1200, 300, 360), // light over the night
    hoursOf(570, 600, 1410, 30), // the evening fade crosses midnight
    hoursOf(1380, 1410, 60, 120), // both fades near midnight
    hoursOf(420, 421, 1260, 1261), // switches a minute wide
    hoursOf(0, 720, 721, 1439), // a fade as long as half a day
    hoursOf(360, 1000, 1001, 1002),
    hoursOf(1, 2, 1438, 1439),
  ];
  for (let i = 0; i < 100; i++) {
    // Four distinct minutes in order round the clock, from a random start.
    const chosen = new Set<number>();
    while (chosen.size < 4) chosen.add(Math.floor(next() * 1440));
    const sorted = [...chosen].sort((a, b) => a - b);
    const start = Math.floor(next() * 4);
    sets.push(hoursOf(...sorted.slice(start), ...sorted.slice(0, start)));
  }
  return sets;
}

function levelCases(): Json[] {
  const next = random(777);
  return validHourSets().map((hours) => {
    const minutes = SUN_HOUR_KEYS.map((key) => parseClock(hours[key])!);
    const moments = new Set<number>([0, MS_PER_DAY - 1, MS_PER_DAY / 2]);
    for (const minute of minutes) {
      const edge = minute * MS_PER_MINUTE;
      for (const offset of [-MS_PER_MINUTE, -1000, -1, 0, 1, 1000, MS_PER_MINUTE]) moments.add((edge + offset + MS_PER_DAY) % MS_PER_DAY);
    }
    // The middle and the quarters of each fade, and some time in each hold.
    for (let i = 0; i < 4; i++) {
      const from = minutes[i];
      const span = (minutes[(i + 1) % 4] - from + 1440) % 1440;
      for (const share of [0.25, 0.5, 0.75]) moments.add((Math.round(from * MS_PER_MINUTE + span * MS_PER_MINUTE * share) + MS_PER_DAY) % MS_PER_DAY);
    }
    for (let i = 0; i < 24; i++) moments.add(Math.floor(next() * MS_PER_DAY));
    return { hours: { ...hours }, nows: [...moments].sort((a, b) => a - b).map((ms) => [ms, levelAtTimeOfDay(hours, ms)]) };
  });
}

function clockCases(): Json[] {
  const text = [
    "00:00", "07:15", "23:59", "12:30", "19:15", "09:05", "24:00", "7:15", "07:60", "07:15:30", " 07:15", "07:15 ", "0715", "", "noon",
    "1:5", "07.15", "07-15", "٠٧:١٥", "07:1", "-1:00", "+7:15",
  ];
  const other: Json[] = [null, 7, 435, true, ["07:15"], { at: "07:15" }];
  return [...text, ...other].map((value) => {
    const minutes = parseClock(value);
    return { value, minutes: minutes ?? null, written: minutes === undefined ? null : formatClock(minutes) };
  });
}

function hourSetCases(): Json[] {
  const set = (lightenFrom: Json, lightFrom: Json, darkenFrom: Json, darkFrom: Json): Json => ({ lightenFrom, lightFrom, darkenFrom, darkFrom });
  const values: Json[] = [
    DEFAULT_SUN_HOURS,
    set("06:00", "07:00", "18:30", "20:00"),
    set("19:00", "20:00", "05:00", "06:00"),
    set("23:30", "00:30", "12:00", "13:00"),
    set("00:00", "00:01", "00:02", "00:03"),
    set("23:57", "23:58", "23:59", "00:00"),
    // the same time twice, or the order wrong
    set("06:00", "06:00", "18:30", "20:00"),
    set("06:00", "07:00", "07:00", "20:00"),
    set("06:00", "07:00", "18:30", "18:30"),
    set("06:00", "07:00", "18:30", "06:00"),
    set("08:00", "07:00", "18:30", "20:00"),
    set("06:00", "20:00", "18:30", "07:00"),
    set("20:00", "18:30", "07:00", "06:00"),
    // two times round the clock
    set("06:00", "18:00", "07:00", "19:00"),
    set("06:00", "12:00", "05:00", "13:00"),
    // not times
    set("6:00", "07:00", "18:30", "20:00"),
    set("06:00", "07:00", "18:30", "24:00"),
    set("06:00", "07:00", "18:30", null),
    set("06:00", "07:00", 1830, "20:00"),
    { lightenFrom: "06:00", lightFrom: "07:00", darkenFrom: "18:30" },
    { ...(DEFAULT_SUN_HOURS as Record<string, Json>), extra: "ignored", location: { name: "Austin" } },
    {},
    [],
    ["05:45", "07:15", "17:45", "19:15"],
    "05:45",
    null,
    0,
    true,
  ];
  return values.map((value) => {
    const checked = validateSunHours(value);
    return { value, valid: checked.hours !== undefined, hours: (checked.hours ?? null) as Json, error: checked.error ?? null, parsed: parseSunHours(value) as unknown as Json };
  });
}

function toneCases(): { tones: Json[]; autoLight: Json[] } {
  const next = random(777);
  const levels = [0, 0.1, 0.44, 0.449999, 0.45, 0.450001, 0.46, 0.5, 0.51, 0.99, 1, ...Array.from({ length: 40 }, () => next())];
  const flips = [undefined, 0.5, 0.46, 0.47, 0, 1];
  const tones = levels.flatMap((level) =>
    flips.map((flip) => ({ level, flip: flip ?? null, tone: toneForLevel(level, flip) })),
  );
  // Every multiple of 1/800 puts `level * 100` on a multiple of 0.125: the ties and near-ties `toFixed(1)` has to round.
  const ties = Array.from({ length: 801 }, (_, k) => k / 800);
  const autoLight = [...levels, ...ties, ...Array.from({ length: 60 }, () => next())].map((level) => ({
    level,
    autoLight: sunThemeAttributes(level).autoLight,
  }));
  return { tones, autoLight };
}

const ZONES = [
  "UTC", "America/Chicago", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Asia/Kolkata", "Asia/Kathmandu", "Australia/Lord_Howe",
  "Pacific/Auckland", "Pacific/Chatham", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/St_Johns", "America/Sao_Paulo",
];

/** Instants that matter for the zones above: ordinary days, the days their clocks change, a leap day and the end of the year. */
const INSTANTS = [
  Date.UTC(2026, 0, 15, 12), Date.UTC(2026, 5, 21, 3), Date.UTC(2026, 11, 31, 23, 30), Date.UTC(2028, 1, 29, 10),
  Date.UTC(2026, 2, 8, 5, 30), Date.UTC(2026, 2, 8, 12), Date.UTC(2026, 2, 29, 0, 30), Date.UTC(2026, 3, 5, 14),
  Date.UTC(2026, 9, 4, 16), Date.UTC(2026, 9, 25, 1), Date.UTC(2026, 10, 1, 7), Date.UTC(2026, 10, 1, 23, 59),
];


/** The instants a zone's clock jumps (forward or back, by an hour or by half of one), where the wall clock and the instant part company. */
const CLOCK_CHANGES: [string, number][] = [
  ["America/Chicago", Date.UTC(2026, 2, 8, 8, 0)],
  ["America/Chicago", Date.UTC(2026, 10, 1, 7, 0)],
  ["Europe/Berlin", Date.UTC(2026, 2, 29, 1, 0)],
  ["Europe/London", Date.UTC(2026, 9, 25, 1, 0)],
  ["Australia/Lord_Howe", Date.UTC(2026, 3, 4, 15, 0)],
  ["Australia/Lord_Howe", Date.UTC(2026, 9, 4, 15, 30)],
  ["America/St_Johns", Date.UTC(2026, 2, 8, 5, 30)],
  ["Pacific/Auckland", Date.UTC(2026, 8, 26, 14, 0)],
  ["America/Sao_Paulo", Date.UTC(2019, 1, 17, 2, 0)],
];

function wallClockCases(): Json[] {
  const ordinary = ZONES.flatMap((timeZone) => INSTANTS.map((now) => ({ timeZone, now, ms: msOfLocalDay(now, timeZone) })));
  const changes = CLOCK_CHANGES.flatMap(([timeZone, at]) =>
    [-1, 0, 1, 60_000].map((offset) => ({ timeZone, now: at + offset, ms: msOfLocalDay(at + offset, timeZone) })),
  );
  return [...ordinary, ...changes];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The palettes, as globals.css declares them

function paletteCases(): { palettes: Json; blends: Json } {
  const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = (selector: string): Record<string, string> => {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // (The first rule's selector list starts after the @import lines, so a selector is the last line of its part.)
      if (!selectors.split(",").some((part) => part.trim().split("\n").at(-1)!.trim() === selector)) continue;
      return Object.fromEntries([...body.matchAll(/(?:--)?([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
    }
    return {};
  };
  const attributes = (pair: string, tone?: "light" | "dark") =>
    `[data-theme="auto"]${pair === "classic" ? "" : `[data-sun-pair="${pair}"]`}[data-tone${tone ? `="${tone}"` : ""}]`;
  const TOKENS = ["background", "foreground", "surface", "panel", "brand", "brand-dim", "highlight", "warning", "error", "success", "link"];
  const SYNTAX = ["comment", "keyword", "string", "number", "function", "type", "attr"];
  const rootAlpha = Number.parseFloat(tokens(":root")["mark-alpha"] ?? "");
  const palettes: Record<string, Json> = {};
  const blends: Record<string, Json> = {};
  for (const { name } of SUN_PAIR_CHOICES) {
    const tones: Record<string, Json> = {};
    for (const tone of ["light", "dark"] as const) {
      const body = tokens(attributes(name, tone));
      tones[tone] = {
        colorScheme: body["color-scheme"] ?? null,
        ...Object.fromEntries(TOKENS.map((token) => [token, body[token] ?? null])),
        // A dark palette says nothing about it and keeps the 38% the root sets.
        markAlpha: Number.parseFloat(body["mark-alpha"] ?? "") || rootAlpha,
        syntax: Object.fromEntries(SYNTAX.map((token) => [token, body[`syntax-${token}`] ?? null])),
      };
    }
    palettes[name] = tones;
    const blend = tokens(attributes(name));
    const endpoints = (token: string) => {
      const match = blend[token]?.match(/^color-mix\(in srgb, (#[0-9a-f]{6}) var\(--auto-light, 0%\), (#[0-9a-f]{6})\)$/);
      return { day: match?.[1] ?? null, night: match?.[2] ?? null };
    };
    blends[name] = { background: endpoints("background"), surface: endpoints("surface"), panel: endpoints("panel") };
  }
  return { palettes, blends };
}

// ---------------------------------------------------------------------------------------------------------------------------------

async function build(): Promise<Json> {
  const { tones, autoLight } = toneCases();
  const { palettes, blends } = paletteCases();
  return {
    about:
      "Made by apps/web/src/lib/composition/sunConformance.test.ts from the desktop's sunHours.ts, sunSchedule.ts, sunPairs.ts and globals.css; SunConformanceTests replays it. Do not edit by hand: UPDATE_FIXTURES=1 pnpm exec vitest run src/lib/composition/sunConformance.test.ts",
    constants: { inkFlipLevel: INK_FLIP_LEVEL, defaultSunPair: DEFAULT_SUN_PAIR, defaultHours: { ...DEFAULT_SUN_HOURS }, msPerDay: MS_PER_DAY },
    pairs: SUN_PAIR_CHOICES.map((choice) => ({ ...choice })),
    pairProbes: [
      ...SUN_PAIR_CHOICES.map((choice) => choice.name),
      "Classic", "classic ", "", "neon", "mint-forest-", null, 5, true, ["classic"], { name: "classic" },
    ].map((value) => ({ value: value as Json, isName: isSunPairName(value), inkFlipLevel: inkFlipLevelOf(value) })),
    clocks: clockCases(),
    hourSets: hourSetCases(),
    levels: levelCases(),
    tones,
    autoLight,
    wallClock: wallClockCases(),
    palettes,
    blends,
  };
}

function format(fixture: Json): string {
  const object = fixture as { [key: string]: Json };
  const sections = Object.entries(object).map(([key, value]) => `  ${JSON.stringify(key)}: ${pretty(value, "  ")}`);
  return `{\n${sections.join(",\n")}\n}\n`;
}

let built: Promise<Json> | undefined;
const fixtureOnce = () => (built ??= build());

describe("the Follow the sun fixture (fixtures/conformance/sun.json)", () => {
  const file = conformancePath("sun.json");

  it(UPDATING_FIXTURES ? "is rewritten from the TypeScript behaviour" : "is what the TypeScript makes", async () => {
    const fixture = JSON.parse(JSON.stringify(await fixtureOnce())) as Json;
    if (UPDATING_FIXTURES) {
      fs.writeFileSync(file, format(fixture));
      return;
    }
    const committed = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
    for (const key of Object.keys(fixture as object)) {
      expect((committed as { [k: string]: Json })[key], `section "${key}"`).toEqual((fixture as { [k: string]: Json })[key]);
    }
    expect(Object.keys(committed as object)).toEqual(Object.keys(fixture as object));
  }, 60_000);

  it("covers what it is meant to", async () => {
    const fixture = JSON.parse(JSON.stringify(await fixtureOnce())) as { [key: string]: Json[] | Json };
    const rows = (key: string) => fixture[key] as { [k: string]: Json }[];
    expect(rows("levels").length).toBeGreaterThan(100);
    expect(rows("levels").some((l) => (l.nows as [number, number][]).some(([, level]) => level > 0 && level < 1))).toBe(true);
    expect(rows("autoLight").length).toBeGreaterThan(800);
    expect(rows("hourSets").some((h) => h.valid === true) && rows("hourSets").some((h) => h.valid === false)).toBe(true);
    expect(rows("clocks").length).toBeGreaterThan(25);
    expect(rows("wallClock").length).toBe(ZONES.length * INSTANTS.length + CLOCK_CHANGES.length * 4);
    // Midnight is 0, never 24 hours, in every zone that has one in the list.
    for (const row of rows("wallClock")) expect(row.ms as number).toBeLessThan(MS_PER_DAY);
  }, 60_000);
});
