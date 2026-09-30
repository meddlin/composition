import { describe, expect, it } from "vitest";
import {
  fallbackSunEvents,
  INK_FLIP_LEVEL,
  RAMP_HALF_WIDTH_MS,
  sunLevel,
  toneForLevel,
  type SunEvent,
} from "./sunSchedule";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MIDNIGHT = Date.UTC(2026, 5, 1);
const sunrise = MIDNIGHT + 6 * HOUR;
const sunset = MIDNIGHT + 19 * HOUR;
const events: SunEvent[] = [
  { at: sunrise - DAY, kind: "sunrise" },
  { at: sunset - DAY, kind: "sunset" },
  { at: sunrise, kind: "sunrise" },
  { at: sunset, kind: "sunset" },
  { at: sunrise + DAY, kind: "sunrise" },
];

describe("sunLevel", () => {
  it("is dark at night and light during the day", () => {
    expect(sunLevel(events, MIDNIGHT + 2 * HOUR)).toBe(0);
    expect(sunLevel(events, MIDNIGHT + 12 * HOUR)).toBe(1);
    expect(sunLevel(events, MIDNIGHT + 23 * HOUR)).toBe(0);
  });

  it("is half way at the moment of sunrise and of sunset", () => {
    expect(sunLevel(events, sunrise)).toBeCloseTo(0.5);
    expect(sunLevel(events, sunset)).toBeCloseTo(0.5);
  });

  it("rises steadily across the sunrise window and falls across the sunset window", () => {
    const rising = [-0.5, -0.25, 0, 0.25, 0.5].map((f) => sunLevel(events, sunrise + f * 2 * RAMP_HALF_WIDTH_MS));
    expect(rising).toEqual([...rising].sort((a, b) => a - b));
    expect(sunLevel(events, sunrise - RAMP_HALF_WIDTH_MS)).toBe(0);
    expect(sunLevel(events, sunrise + RAMP_HALF_WIDTH_MS)).toBe(1);

    const falling = [-0.5, -0.25, 0, 0.25, 0.5].map((f) => sunLevel(events, sunset + f * 2 * RAMP_HALF_WIDTH_MS));
    expect(falling).toEqual([...falling].sort((a, b) => b - a));
    expect(sunLevel(events, sunset - RAMP_HALF_WIDTH_MS)).toBe(1);
    expect(sunLevel(events, sunset + RAMP_HALF_WIDTH_MS)).toBe(0);
  });

  it("does not depend on the order events are given in", () => {
    const now = sunset + 10 * 60 * 1000;
    expect(sunLevel([...events].reverse(), now)).toBe(sunLevel(events, now));
  });

  it("infers the state before the first known event from its kind", () => {
    const now = MIDNIGHT;
    expect(sunLevel([{ at: sunrise, kind: "sunrise" }], now)).toBe(0);
    expect(sunLevel([{ at: sunset, kind: "sunset" }], now)).toBe(1);
  });

  it("is dark when there are no events", () => {
    expect(sunLevel([], MIDNIGHT)).toBe(0);
  });
});

describe("toneForLevel", () => {
  it("switches text at the flip level", () => {
    expect(toneForLevel(0)).toBe("dark");
    expect(toneForLevel(INK_FLIP_LEVEL - 0.01)).toBe("dark");
    expect(toneForLevel(INK_FLIP_LEVEL)).toBe("light");
    expect(toneForLevel(1)).toBe("light");
  });
});

describe("fallbackSunEvents", () => {
  it("puts sunrise before sunset on each of three days, with the day in between light", () => {
    const now = new Date(2026, 5, 10, 12, 0).getTime();
    const fallback = fallbackSunEvents(now);

    expect(fallback.map((e) => e.kind)).toEqual(["sunrise", "sunset", "sunrise", "sunset", "sunrise", "sunset"]);
    expect(fallback.map((e) => e.at)).toEqual([...fallback.map((e) => e.at)].sort((a, b) => a - b));
    expect(sunLevel(fallback, now)).toBe(1);
    expect(sunLevel(fallback, new Date(2026, 5, 10, 2, 0).getTime())).toBe(0);
  });
});
