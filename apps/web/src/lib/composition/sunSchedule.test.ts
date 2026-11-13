import { describe, expect, it } from "vitest";
import { DEFAULT_SUN_HOURS, type SunHours } from "./sunHours";
import {
  INK_FLIP_LEVEL,
  levelAtTimeOfDay,
  MS_PER_MINUTE,
  msOfLocalDay,
  sunLevel,
  sunThemeAttributes,
  toneForLevel,
} from "./sunSchedule";

const at = (clock: string) => {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours * 60 + minutes) * MS_PER_MINUTE;
};

describe("levelAtTimeOfDay with the default hours (05:45, 07:15, 17:45, 19:15)", () => {
  const level = (clock: string) => levelAtTimeOfDay(DEFAULT_SUN_HOURS, at(clock));

  it("is dark at night and light during the day", () => {
    expect(level("00:00")).toBe(0);
    expect(level("03:00")).toBe(0);
    expect(level("12:00")).toBe(1);
    expect(level("21:00")).toBe(0);
    expect(level("23:59")).toBe(0);
  });

  it("is half way in the middle of each fade, and at the ends of it exactly 0 and 1", () => {
    expect(level("06:30")).toBeCloseTo(0.5, 12);
    expect(level("18:30")).toBeCloseTo(0.5, 12);
    expect(level("05:45")).toBe(0);
    expect(level("07:15")).toBe(1);
    expect(level("17:45")).toBe(1);
    expect(level("19:15")).toBe(0);
  });

  it("rises steadily over the first fade and falls steadily over the second", () => {
    const rising = ["05:45", "06:00", "06:15", "06:30", "06:45", "07:00", "07:15"].map(level);
    expect(rising).toEqual([...rising].sort((a, b) => a - b));
    const falling = ["17:45", "18:00", "18:15", "18:30", "18:45", "19:00", "19:15"].map(level);
    expect(falling).toEqual([...falling].sort((a, b) => b - a));
  });

  it("is what the scheme did before the hours were set by hand, with no city saved: 06:30 and 18:30 with a 90-minute fade centred on each", () => {
    const old = (clock: string, event: string, kind: "sunrise" | "sunset") => {
      const progress = (at(clock) - at(event) + 45 * MS_PER_MINUTE) / (90 * MS_PER_MINUTE);
      if (progress < 0 || progress > 1) return undefined;
      const eased = progress * progress * (3 - 2 * progress);
      return kind === "sunrise" ? eased : 1 - eased;
    };
    for (const clock of ["05:45", "06:00", "06:20", "06:30", "06:55", "07:15"]) expect(level(clock)).toBe(old(clock, "06:30", "sunrise"));
    for (const clock of ["17:45", "18:10", "18:30", "18:50", "19:15"]) expect(level(clock)).toBe(old(clock, "18:30", "sunset"));
  });
});

describe("levelAtTimeOfDay with other hours", () => {
  it("lets a fade cross midnight, and the day begin in the evening (light over the night)", () => {
    const night: SunHours = { lightenFrom: "19:00", lightFrom: "20:00", darkenFrom: "05:00", darkFrom: "06:00" };
    expect(levelAtTimeOfDay(night, at("12:00"))).toBe(0);
    expect(levelAtTimeOfDay(night, at("19:30"))).toBeCloseTo(0.5, 12);
    expect(levelAtTimeOfDay(night, at("23:00"))).toBe(1);
    expect(levelAtTimeOfDay(night, at("00:00"))).toBe(1);
    expect(levelAtTimeOfDay(night, at("05:30"))).toBeCloseTo(0.5, 12);
    expect(levelAtTimeOfDay(night, at("07:00"))).toBe(0);

    const across: SunHours = { lightenFrom: "09:00", lightFrom: "10:00", darkenFrom: "23:30", darkFrom: "00:30" };
    expect(levelAtTimeOfDay(across, at("23:00"))).toBe(1);
    expect(levelAtTimeOfDay(across, at("00:00"))).toBeCloseTo(0.5, 12);
    expect(levelAtTimeOfDay(across, at("00:45"))).toBe(0);
  });

  it("switches in a minute when the hours are a minute apart", () => {
    const quick: SunHours = { lightenFrom: "07:00", lightFrom: "07:01", darkenFrom: "21:00", darkFrom: "21:01" };
    expect(levelAtTimeOfDay(quick, at("06:59"))).toBe(0);
    expect(levelAtTimeOfDay(quick, at("07:00") + 30_000)).toBeCloseTo(0.5, 12);
    expect(levelAtTimeOfDay(quick, at("07:01"))).toBe(1);
  });

  it("reads hours that do not go round the clock in order as the defaults", () => {
    const out: SunHours = { lightenFrom: "08:00", lightFrom: "07:00", darkenFrom: "18:00", darkFrom: "19:00" };
    expect(levelAtTimeOfDay(out, at("06:30"))).toBe(levelAtTimeOfDay(DEFAULT_SUN_HOURS, at("06:30")));
  });

  it("stays between 0 and 1 at every second of the day", () => {
    for (let second = 0; second < 86_400; second += 37) {
      const level = levelAtTimeOfDay(DEFAULT_SUN_HOURS, second * 1000);
      expect(level >= 0 && level <= 1).toBe(true);
    }
  });
});

describe("msOfLocalDay", () => {
  it("is the wall clock of the zone, to the millisecond", () => {
    const instant = Date.UTC(2026, 10, 9, 14, 30, 15, 250);
    expect(msOfLocalDay(instant, "UTC")).toBe(((14 * 60 + 30) * 60 + 15) * 1000 + 250);
    expect(msOfLocalDay(instant, "America/Chicago")).toBe(((8 * 60 + 30) * 60 + 15) * 1000 + 250);
    expect(msOfLocalDay(instant, "Asia/Kathmandu")).toBe(((20 * 60 + 15) * 60 + 15) * 1000 + 250);
  });

  it("reads midnight as 0, not 24 hours", () => {
    expect(msOfLocalDay(Date.UTC(2026, 10, 9, 0, 0, 0, 0), "UTC")).toBe(0);
    expect(msOfLocalDay(Date.UTC(2026, 10, 9, 23, 59, 59, 999), "UTC")).toBe(86_399_999);
  });

  it("follows the wall across a clock change: the day a zone springs forward has no 02:30", () => {
    // Chicago, 2026-03-08: 02:00 CST becomes 03:00 CDT at 08:00 UTC.
    expect(msOfLocalDay(Date.UTC(2026, 2, 8, 7, 59, 59, 0), "America/Chicago")).toBe(((1 * 60 + 59) * 60 + 59) * 1000);
    expect(msOfLocalDay(Date.UTC(2026, 2, 8, 8, 0, 0, 0), "America/Chicago")).toBe(3 * 3600 * 1000);
  });

  it("uses the machine's own clock when no zone is named", () => {
    const now = new Date(2026, 5, 10, 13, 5, 9, 7).getTime();
    expect(msOfLocalDay(now)).toBe(((13 * 60 + 5) * 60 + 9) * 1000 + 7);
    expect(sunLevel(DEFAULT_SUN_HOURS, now)).toBe(1);
    expect(sunLevel(DEFAULT_SUN_HOURS, new Date(2026, 5, 10, 2, 0).getTime())).toBe(0);
  });
});

describe("a pair's own flip level", () => {
  it("moves where the tone changes, for toneForLevel and sunThemeAttributes alike", () => {
    expect(toneForLevel(0.47)).toBe("light");
    expect(toneForLevel(0.47, 0.5)).toBe("dark");
    expect(toneForLevel(0.5, 0.5)).toBe("light");
    expect(sunThemeAttributes(0.47, 0.5)).toEqual({ tone: "dark", autoLight: "47.0%" });
    expect(sunThemeAttributes(0.47)).toEqual({ tone: "light", autoLight: "47.0%" });
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
