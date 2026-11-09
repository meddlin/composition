import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { conformancePath, UPDATING_FIXTURES } from "./__fixtures__/conformance";
import {
  DEFAULT_SUN_PAIR,
  SUN_PAIR_CHOICES,
  inkFlipLevelOf,
  isSunPairName,
} from "./sunPairs";
import {
  INK_FLIP_LEVEL,
  RAMP_HALF_WIDTH_MS,
  fallbackSunEvents,
  sunLevel,
  sunThemeAttributes,
  toneForLevel,
  type SunEvent,
} from "./sunSchedule";

/**
 * "Follow the sun" is a pure function of sunrise and sunset times, which the Swift core ports (`CompositionCore/Sun`), so it must
 * agree exactly. This test pins what the Swift side replays, `fixtures/conformance/sun.json` (see fixtures/conformance/README.md):
 *
 *   constants, pairs, pairProbes   sunSchedule.ts and sunPairs.ts: the ramp, the flip points, the five pairs and what names them
 *   levels, tones, autoLight       sunLevel over many event lists (unsorted, tied, one-sided, overlapping), toneForLevel, and the
 *                                  `--auto-light` text `toFixed(1)` makes
 *   fallback                       the stand-in 06:30 and 18:30 events in fourteen time zones, across their clock changes
 *   todays                         todaysSunTimes: the sunrise and sunset that fall on today's date in a city's own zone
 *   geocode, loads                 geocodeCity and the sun-event cache of sunTimes.ts, driven with canned Open-Meteo answers
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BASE = Date.UTC(2026, 10, 9, 12, 0, 0);
const ev = (kind: SunEvent["kind"], at: number): SunEvent => ({ at, kind });

function levelCases(): Json[] {
  const next = random(20261109);
  const lists: SunEvent[][] = [
    [],
    [ev("sunrise", BASE)],
    [ev("sunset", BASE)],
    // three ordinary days
    [-1, 0, 1].flatMap((d) => [ev("sunrise", BASE + d * DAY - 5.3 * HOUR), ev("sunset", BASE + d * DAY + 4.9 * HOUR)]),
    // the same, out of order
    [ev("sunset", BASE + DAY + 4.9 * HOUR), ev("sunrise", BASE - 5.3 * HOUR), ev("sunset", BASE - DAY + 4.9 * HOUR), ev("sunrise", BASE + DAY - 5.3 * HOUR)],
    // two events at the same moment, both ways round (the sort must keep their order)
    [ev("sunrise", BASE), ev("sunset", BASE)],
    [ev("sunset", BASE), ev("sunrise", BASE)],
    // a day shorter than the ramp, a night shorter than the ramp
    [ev("sunrise", BASE), ev("sunset", BASE + 10 * 60_000)],
    [ev("sunset", BASE), ev("sunrise", BASE + 20 * 60_000)],
    // the same event twice, then the epoch itself
    [ev("sunrise", BASE), ev("sunrise", BASE), ev("sunset", BASE + 8 * HOUR)],
    [ev("sunset", 0), ev("sunrise", RAMP_HALF_WIDTH_MS * 2)],
    // two sunrises with no sunset between (polar edge), then two sunsets
    [ev("sunrise", BASE - DAY), ev("sunrise", BASE + DAY)],
    [ev("sunset", BASE - DAY), ev("sunset", BASE + DAY)],
  ];
  for (let i = 0; i < 30; i++) {
    const count = Math.floor(next() * 7);
    lists.push(
      Array.from({ length: count }, () => ev(next() < 0.5 ? "sunrise" : "sunset", BASE + Math.round((next() * 6 - 3) * DAY / 1000) * 1000)),
    );
  }
  return lists.map((events) => {
    const moments = new Set<number>([BASE, 0, BASE - 40 * DAY, BASE + 40 * DAY]);
    for (const { at } of events) {
      for (const offset of [-RAMP_HALF_WIDTH_MS - 1, -RAMP_HALF_WIDTH_MS, -RAMP_HALF_WIDTH_MS + 1, -RAMP_HALF_WIDTH_MS / 2, -1, 0, 1, RAMP_HALF_WIDTH_MS / 2, RAMP_HALF_WIDTH_MS - 1, RAMP_HALF_WIDTH_MS, RAMP_HALF_WIDTH_MS + 1]) {
        moments.add(at + offset);
      }
      moments.add(at + Math.round(next() * 2 * RAMP_HALF_WIDTH_MS - RAMP_HALF_WIDTH_MS));
    }
    const min = events.length ? Math.min(...events.map((e) => e.at)) : BASE;
    const max = events.length ? Math.max(...events.map((e) => e.at)) : BASE;
    moments.add(min - DAY);
    moments.add(max + DAY);
    moments.add(Math.round((min + max) / 2));
    return { events: events.map((e) => ({ ...e })), nows: [...moments].map((now) => [now, sunLevel(events, now)]) };
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

/** Runs `body` with the process in the zone, as the machine-local zone `fallbackSunEvents` reads. */
function inZone<T>(zone: string, body: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    // The zone must really have changed (it does on Node's main thread and in a forked worker; not in a worker thread).
    const t = Date.UTC(2026, 6, 1, 12);
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(t));
    expect(new Date(t).getHours(), `the process is in ${zone}`).toBe(hour);
    return body();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

function fallbackCases(): Json[] {
  return ZONES.flatMap((timeZone) =>
    INSTANTS.map((now) => ({ timeZone, now, events: inZone(timeZone, () => fallbackSunEvents(now)).map((e) => ({ ...e })) })),
  );
}

type Loc = { name: string; latitude: number; longitude: number; timezone: string };

async function todaysCases(): Promise<Json[]> {
  const { todaysSunTimes } = await import("./sunTimes");
  const cases: Json[] = [];
  const zones = [...ZONES, "Europe/Oslo", "America/Los_Angeles", "Asia/Dubai", "Etc/GMT+12", "Africa/Cairo"];
  for (const timeZone of zones) {
    for (const now of INSTANTS.slice(0, 6)) {
      // Sunrise and sunset for the days around `now`, 17 minutes later each day, plus events at the edges of the local day.
      const events: SunEvent[] = [];
      for (let d = -1; d <= 1; d++) {
        events.push(ev("sunrise", now + d * DAY - 5 * HOUR + d * 17 * 60_000), ev("sunset", now + d * DAY + 6 * HOUR + d * 17 * 60_000));
      }
      cases.push({ timeZone, now, events: events.map((e) => ({ ...e })), times: todaysSunTimes(events, timeZone, now) as Json });
    }
  }
  // Odd shapes in one zone: nothing today, two of a kind in a day (the later wins), events out of order, the first and last millisecond of a local day.
  const zone = "America/Chicago";
  const noon = Date.UTC(2026, 10, 9, 18);
  const odd: SunEvent[][] = [
    [],
    [ev("sunrise", noon - 5 * DAY)],
    [ev("sunrise", noon - 4 * HOUR), ev("sunrise", noon - 3 * HOUR), ev("sunset", noon + 3 * HOUR)],
    [ev("sunset", noon + 3 * HOUR), ev("sunrise", noon - 4 * HOUR)],
    [ev("sunrise", Date.UTC(2026, 10, 9, 6, 0, 0)), ev("sunset", Date.UTC(2026, 10, 10, 5, 59, 59, 999))],
    [ev("sunrise", Date.UTC(2026, 10, 9, 5, 59, 59, 999)), ev("sunset", Date.UTC(2026, 10, 10, 6, 0, 0))],
    [ev("sunrise", noon + 0.4), ev("sunset", noon + 7 * HOUR + 0.6)],
    [ev("sunrise", Date.UTC(2026, 10, 9, 12, 5)), ev("sunset", Date.UTC(2026, 10, 9, 23, 7))],
    [ev("sunrise", Date.UTC(2026, 10, 9, 6, 7)), ev("sunset", Date.UTC(2026, 10, 9, 17, 0))],
    // The same day number in another month and in another year is not today.
    [ev("sunrise", Date.UTC(2026, 9, 9, 13)), ev("sunset", Date.UTC(2026, 11, 9, 23)), ev("sunrise", Date.UTC(2027, 10, 9, 13)), ev("sunset", Date.UTC(2025, 10, 9, 23))],
    [ev("sunrise", Date.UTC(2026, 9, 9, 13)), ev("sunset", Date.UTC(2026, 10, 9, 23)), ev("sunrise", Date.UTC(2025, 10, 9, 13))],
  ];
  for (const events of odd) {
    cases.push({ timeZone: zone, now: noon, events: events.map((e) => ({ ...e })), times: todaysSunTimes(events, zone, noon) as Json });
  }
  // A zone that does not exist: the desktop throws a RangeError.
  expect(() => todaysSunTimes([ev("sunrise", noon)], "Not/AZone", noon)).toThrow(RangeError);
  cases.push({ timeZone: "Not/AZone", now: noon, events: [{ at: noon, kind: "sunrise" }], throws: true });
  // The clock reads like this in this build of Node; the Swift side writes the same text with an ordinary space.
  return cases.map((c) => JSON.parse(JSON.stringify(c).replace(/\u202f/g, " ")) as Json);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Open-Meteo, with canned answers

type Spec = { kind: "ok"; body: Json } | { kind: "status"; status: number } | { kind: "throw" } | { kind: "badjson" };

/** A `fetch` that says what it was asked for and answers as the spec says. */
function fakeFetch(spec: Spec, requests: string[]): typeof fetch {
  return (async (url: URL | string) => {
    requests.push(String(url));
    await Promise.resolve();
    if (spec.kind === "throw") throw new TypeError("network down");
    return {
      ok: spec.kind !== "status",
      status: spec.kind === "status" ? spec.status : 200,
      json: async () => {
        if (spec.kind === "badjson") throw new SyntaxError("not json");
        return spec.kind === "ok" ? spec.body : null;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const forecast = (sunrise: Json, sunset: Json): Json => ({ daily: { time: [1, 2, 3, 4], sunrise, sunset } });
const answer = (body: Json): Spec => ({ kind: "ok", body });

const austin: Loc = { name: "Austin, Texas, United States", latitude: 30.26715, longitude: -97.74306, timezone: "America/Chicago" };
const tromso: Loc = { name: "Tromsø, Troms, Norway", latitude: 69.6496, longitude: 18.957, timezone: "Europe/Oslo" };
const T0 = Date.UTC(2026, 10, 9, 14, 0, 0);
const seconds = (ms: number) => Math.round(ms / 1000);
const okAustin = answer(
  forecast(
    [T0 / 1000 - DAY / 1000 + 1000, seconds(T0 + 15 * HOUR), seconds(T0 + 39 * HOUR), seconds(T0 + 63 * HOUR)],
    [seconds(T0 - 5 * HOUR), seconds(T0 + 20 * HOUR), seconds(T0 + 44 * HOUR), seconds(T0 + 68 * HOUR)],
  ),
);

type Step =
  | { op: "load"; now: number; location: Loc; fetch: Spec }
  | { op: "loadMany"; now: number; location: Loc; fetch: Spec; count: number }
  | { op: "resolve"; now: number; location: Loc | null; fetch: Spec }
  | { op: "cached"; now: number; location: Loc | null };

const NOT_USED: Spec = { kind: "throw" };
const SCENARIOS: { name: string; steps: Step[] }[] = [
  {
    name: "a good answer is reused for six hours, then asked for again",
    steps: [
      { op: "load", now: T0, location: austin, fetch: okAustin },
      { op: "load", now: T0 + HOUR, location: austin, fetch: NOT_USED },
      { op: "load", now: T0 + 6 * HOUR - 1, location: austin, fetch: NOT_USED },
      { op: "load", now: T0 + 6 * HOUR, location: austin, fetch: okAustin },
      { op: "load", now: T0 + 6 * HOUR + 1, location: austin, fetch: NOT_USED },
    ],
  },
  {
    name: "the cache is keyed by latitude and longitude alone",
    steps: [
      { op: "load", now: T0, location: austin, fetch: okAustin },
      { op: "load", now: T0 + 1, location: { ...austin, name: "Somewhere else", timezone: "UTC" }, fetch: NOT_USED },
      { op: "load", now: T0 + 2, location: { ...austin, latitude: 30.26716 }, fetch: okAustin },
      { op: "load", now: T0 + 3, location: tromso, fetch: answer(forecast([], [])) },
    ],
  },
  {
    name: "numbers are written into the address the way JavaScript writes them",
    steps: [
      { op: "load", now: T0, location: { name: "a", latitude: 0, longitude: 0, timezone: "UTC" }, fetch: { kind: "ok", body: {} } },
      { op: "load", now: T0, location: { name: "b", latitude: -0.5, longitude: 5e-7, timezone: "UTC" }, fetch: { kind: "ok", body: {} } },
      { op: "load", now: T0, location: { name: "c", latitude: 90, longitude: -180, timezone: "UTC" }, fetch: { kind: "ok", body: {} } },
      { op: "load", now: T0, location: { name: "d", latitude: 0.1 + 0.2, longitude: 1e21, timezone: "UTC" }, fetch: { kind: "ok", body: {} } },
      { op: "load", now: T0, location: { name: "e", latitude: 12.345678901234567, longitude: -1e-7, timezone: "UTC" }, fetch: { kind: "ok", body: {} } },
    ],
  },
  {
    name: "polar gaps (null), words and out-of-order times in the answer",
    steps: [
      { op: "load", now: T0, location: tromso, fetch: { kind: "ok", body: forecast([null, 1_800_000_000, null, 1_800_086_400], [1_800_043_200, null, "x", 1_800_129_600]) } },
      { op: "load", now: T0 + 7 * HOUR, location: { ...tromso, latitude: 70 }, fetch: { kind: "ok", body: forecast([300, 100, 200], [250, 150, 50]) } },
      { op: "load", now: T0, location: { ...tromso, latitude: 71 }, fetch: { kind: "ok", body: forecast([100.5, 100, true, [5], {}], [100, 100.4999]) } },
    ],
  },
  {
    name: "a time that is the same moment for a sunrise and a sunset keeps the sunrises first",
    steps: [{ op: "load", now: T0, location: austin, fetch: { kind: "ok", body: forecast([500, 700], [500, 600]) } }],
  },
  {
    name: "answers of unexpected shape, each looked at again three minutes later (a good answer is kept, a failed one is asked for again)",
    steps: [
      { op: "load", now: T0, location: { ...austin, latitude: 1 }, fetch: { kind: "ok", body: {} } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 1 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 2 }, fetch: { kind: "ok", body: [] } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 2 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 3 }, fetch: { kind: "ok", body: { daily: null } } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 3 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 4 }, fetch: { kind: "ok", body: { daily: "text" } } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 4 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 5 }, fetch: { kind: "ok", body: { daily: { sunrise: "abc", sunset: null } } } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 5 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 6 }, fetch: { kind: "ok", body: { daily: { sunrise: 5 } } } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 6 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 7 }, fetch: { kind: "ok", body: { daily: { sunrise: {} } } } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 7 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 8 }, fetch: { kind: "ok", body: { daily: { sunset: true } } } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 8 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 9 }, fetch: { kind: "ok", body: null } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 9 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 10 }, fetch: { kind: "ok", body: 7 } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 10 }, fetch: NOT_USED },
      { op: "load", now: T0, location: { ...austin, latitude: 11 }, fetch: { kind: "ok", body: "text" } },
      { op: "load", now: T0 + 180_000, location: { ...austin, latitude: 11 }, fetch: NOT_USED },
    ],
  },
  {
    name: "a failure with nothing cached gives no events and waits two minutes before trying again",
    steps: [
      { op: "load", now: T0, location: austin, fetch: { kind: "status", status: 503 } },
      { op: "load", now: T0 + 119_999, location: austin, fetch: NOT_USED },
      { op: "load", now: T0 + 120_000, location: austin, fetch: { kind: "throw" } },
      { op: "load", now: T0 + 120_001, location: austin, fetch: NOT_USED },
      { op: "load", now: T0 + 240_000, location: austin, fetch: { kind: "badjson" } },
      { op: "load", now: T0 + 360_000, location: austin, fetch: okAustin },
      { op: "load", now: T0 + 360_001, location: austin, fetch: NOT_USED },
    ],
  },
  {
    name: "a failure after a good answer keeps serving the good one",
    steps: [
      { op: "load", now: T0, location: austin, fetch: okAustin },
      { op: "load", now: T0 + 6 * HOUR, location: austin, fetch: { kind: "status", status: 500 } },
      { op: "load", now: T0 + 6 * HOUR + 60_000, location: austin, fetch: NOT_USED },
      { op: "load", now: T0 + 6 * HOUR + 120_000, location: austin, fetch: { kind: "throw" } },
      { op: "load", now: T0 + 6 * HOUR + 240_000, location: austin, fetch: okAustin },
    ],
  },
  {
    name: "simultaneous callers share one request, and one failure",
    steps: [
      { op: "loadMany", now: T0, location: austin, fetch: okAustin, count: 4 },
      { op: "loadMany", now: T0 + 7 * HOUR, location: austin, fetch: { kind: "throw" }, count: 3 },
      { op: "loadMany", now: T0 + 8 * HOUR, location: tromso, fetch: { kind: "status", status: 429 }, count: 2 },
    ],
  },
  {
    name: "resolving: real times, stand-ins with nothing saved, stand-ins and a retry when a saved city fails",
    steps: [
      { op: "resolve", now: T0 + 3 * HOUR, location: null, fetch: NOT_USED },
      { op: "cached", now: T0, location: austin },
      { op: "resolve", now: T0, location: austin, fetch: okAustin },
      { op: "cached", now: T0 + 5 * HOUR, location: austin },
      { op: "cached", now: T0 + 5 * HOUR, location: null },
      { op: "resolve", now: T0 + 20 * HOUR, location: austin, fetch: NOT_USED },
      { op: "resolve", now: T0 + 3 * HOUR, location: tromso, fetch: { kind: "throw" } },
      { op: "cached", now: T0 + 3 * HOUR, location: tromso },
      { op: "resolve", now: T0 + 3 * HOUR + 120_000, location: tromso, fetch: answer(forecast([], [])) },
      { op: "resolve", now: T0 + 4 * HOUR, location: { ...tromso, longitude: 19 }, fetch: answer(forecast([seconds(T0 + 2 * HOUR)], [seconds(T0 + 11 * HOUR)])) },
    ],
  },
];

async function runScenario(steps: Step[]): Promise<Json[]> {
  vi.resetModules();
  // The stand-in times are machine-local; the scenarios are written for UTC.
  const before = process.env.TZ;
  process.env.TZ = "UTC";
  try {
    const sun = await import("./sunTimes");
    const out: Json[] = [];
    for (const step of steps) {
      const requests: string[] = [];
      const fetchImpl = fakeFetch("fetch" in step ? step.fetch : NOT_USED, requests);
      const events = (list: readonly SunEvent[]) => list.map((e) => ({ at: e.at, kind: e.kind }));
      const schedule = (s: { events: SunEvent[]; level: number; estimated: boolean; retry: boolean }) => ({ ...s, events: events(s.events) });
      let result: Json;
      switch (step.op) {
        case "load":
          result = { events: events(await sun.loadSunEvents(step.location, step.now, fetchImpl)) };
          break;
        case "loadMany": {
          const all = await Promise.all(Array.from({ length: step.count }, () => sun.loadSunEvents(step.location, step.now, fetchImpl)));
          result = { many: all.map(events) };
          break;
        }
        case "resolve":
          result = { schedule: schedule(await sun.resolveSunSchedule(step.location ?? undefined, step.now, fetchImpl)) };
          break;
        case "cached":
          result = { schedule: schedule(sun.cachedSunSchedule(step.location ?? undefined, step.now)) };
          break;
      }
      out.push({ ...step, ...(result as object), requests } as Json);
    }
    return out;
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The city lookup

const geo = (...results: Json[]): Spec => ({ kind: "ok", body: { results } });
const hit = (extra: Record<string, Json> = {}): Json => ({
  name: "Austin", admin1: "Texas", country: "United States", latitude: 30.26715, longitude: -97.74306, timezone: "America/Chicago", ...extra,
});

const GEOCODE: { query: string; fetch: Spec }[] = [
  { query: "Austin, TX", fetch: geo(hit(), hit({ name: "Austin, MN" })) },
  { query: "Paris", fetch: geo(hit({ name: "Paris", admin1: "Île-de-France", country: "France", latitude: 48.85341, longitude: 2.3488, timezone: "Europe/Paris" })) },
  { query: "São Paulo", fetch: geo(hit({ name: "São Paulo", admin1: "São Paulo", country: "Brazil", latitude: -23.5475, longitude: -46.63611, timezone: "America/Sao_Paulo" })) },
  { query: "St. John's & co=?#%", fetch: geo(hit({ name: "St. John's", admin1: "Newfoundland and Labrador", country: "Canada" })) },
  { query: "東京", fetch: geo(hit({ name: "東京都", admin1: "", country: "日本", timezone: "Asia/Tokyo" })) },
  { query: "a+b c~d*e(f)g!h'i-j_k.l", fetch: geo(hit()) },
  { query: "Zürich  ", fetch: geo(hit({ name: "Zürich", admin1: undefined as unknown as Json, country: "Switzerland" })) },
  { query: "", fetch: geo() },
  { query: "nowhere", fetch: { kind: "ok", body: {} } },
  { query: "nowhere", fetch: geo() },
  { query: "no admin", fetch: geo(hit({ admin1: null, country: null })) },
  { query: "empty parts", fetch: geo(hit({ name: "", admin1: "", country: "" })) },
  { query: "name only", fetch: geo(hit({ admin1: "", country: "" })) },
  { query: "name not a string", fetch: geo(hit({ name: 5 })) },
  { query: "region and country that are not strings", fetch: geo(hit({ admin1: 5, country: true })) },
  { query: "region and country that are false", fetch: geo(hit({ admin1: 0, country: false })) },
  { query: "no name", fetch: geo({ latitude: 1, longitude: 2, timezone: "UTC" }) },
  { query: "latitude a string", fetch: geo(hit({ latitude: "30.2" })) },
  { query: "no longitude", fetch: geo(hit({ longitude: null })) },
  { query: "no timezone", fetch: geo(hit({ timezone: undefined as unknown as Json })) },
  { query: "latitude out of range", fetch: geo(hit({ latitude: 91, longitude: 181 })) },
  { query: "first result is bad", fetch: geo({ name: "x" }, hit()) },
  { query: "result is null", fetch: geo(null) },
  { query: "result is a number", fetch: geo(5) },
  { query: "results is an object with a zero key", fetch: { kind: "ok", body: { results: { "0": hit({ name: "Zero" }) } } } },
  { query: "results is a string", fetch: { kind: "ok", body: { results: "Austin" } } },
  { query: "results is null", fetch: { kind: "ok", body: { results: null } } },
  { query: "body is null", fetch: { kind: "ok", body: null } },
  { query: "body is a number", fetch: { kind: "ok", body: 7 } },
  { query: "server error", fetch: { kind: "status", status: 500 } },
  { query: "not found", fetch: { kind: "status", status: 404 } },
  { query: "offline", fetch: { kind: "throw" } },
  { query: "not json", fetch: { kind: "badjson" } },
];

async function geocodeCases(): Promise<Json[]> {
  const { geocodeCity } = await import("./sunTimes");
  const out: Json[] = [];
  for (const { query, fetch: spec } of GEOCODE) {
    const requests: string[] = [];
    let result: Json;
    try {
      result = (await geocodeCity(query, fakeFetch(spec, requests))) as Json;
    } catch {
      result = { throws: true };
    }
    out.push({ query, fetch: JSON.parse(JSON.stringify(spec)), result, requests });
  }
  return out;
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
  const scenarios: Json[] = [];
  for (const { name, steps } of SCENARIOS) scenarios.push({ name, steps: await runScenario(steps) });
  return {
    about:
      "Made by apps/web/src/lib/composition/sunConformance.test.ts from the desktop's sunSchedule.ts, sunPairs.ts, sunTimes.ts and globals.css; SunConformanceTests replays it. Do not edit by hand: UPDATE_FIXTURES=1 pnpm exec vitest run src/lib/composition/sunConformance.test.ts",
    constants: { rampHalfWidthMs: RAMP_HALF_WIDTH_MS, inkFlipLevel: INK_FLIP_LEVEL, defaultSunPair: DEFAULT_SUN_PAIR },
    pairs: SUN_PAIR_CHOICES.map((choice) => ({ ...choice })),
    pairProbes: [
      ...SUN_PAIR_CHOICES.map((choice) => choice.name),
      "Classic", "classic ", "", "neon", "mint-forest-", null, 5, true, ["classic"], { name: "classic" },
    ].map((value) => ({ value: value as Json, isName: isSunPairName(value), inkFlipLevel: inkFlipLevelOf(value) })),
    levels: levelCases(),
    tones,
    autoLight,
    fallback: fallbackCases(),
    todays: await todaysCases(),
    geocode: await geocodeCases(),
    loads: scenarios,
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
    expect(rows("levels").length).toBeGreaterThan(40);
    expect(rows("levels").some((l) => (l.nows as [number, number][]).some(([, level]) => level > 0 && level < 1))).toBe(true);
    expect(rows("autoLight").length).toBeGreaterThan(800);
    expect(rows("fallback").length).toBe(ZONES.length * INSTANTS.length);
    // Every fallback day has six events, a sunrise and a sunset for yesterday, today and tomorrow, at 06:30 and 18:30 local time.
    for (const row of rows("fallback")) expect(row.events as Json[]).toHaveLength(6);
    expect(rows("todays").some((t) => t.throws === true)).toBe(true);
    expect(rows("geocode").some((g) => (g.result as { throws?: boolean } | null)?.throws)).toBe(true);
    expect(rows("loads").length).toBe(SCENARIOS.length);
  }, 60_000);
});
