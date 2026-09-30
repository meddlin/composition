import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SunEvent } from "./sunSchedule";

// The cache is module state, so import a fresh copy for every test.
let sunTimes: typeof import("./sunTimes");

beforeEach(async () => {
  vi.resetModules();
  sunTimes = await import("./sunTimes");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const austin = {
  name: "Austin, Texas, United States",
  latitude: 30.26715,
  longitude: -97.74306,
  timezone: "America/Chicago",
};

// 2026-09-30: sunrise 06:43 and sunset 18:31 CDT (UTC-5), as epoch seconds.
const SUNRISE = Date.UTC(2026, 8, 30, 11, 43) / 1000;
const SUNSET = Date.UTC(2026, 8, 30, 23, 31) / 1000;
const NOW = Date.UTC(2026, 8, 30, 17, 0);

describe("geocodeCity", () => {
  it("returns the best match with a readable name", async () => {
    const fetchMock = respondWith({
      results: [
        {
          name: "Austin",
          admin1: "Texas",
          country: "United States",
          latitude: austin.latitude,
          longitude: austin.longitude,
          timezone: austin.timezone,
        },
      ],
    });

    const city = await sunTimes.geocodeCity("Austin, TX", fetchMock);

    expect(city).toEqual(austin);
    const requested = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(requested.searchParams.get("name")).toBe("Austin, TX");
    expect(requested.searchParams.get("count")).toBe("1");
  });

  it("skips missing parts of the name", async () => {
    const fetchMock = respondWith({
      results: [{ name: "Null Island", latitude: 0, longitude: 0, timezone: "UTC" }],
    });

    expect((await sunTimes.geocodeCity("Null Island", fetchMock))?.name).toBe("Null Island");
  });

  it("returns null when nothing matches", async () => {
    expect(await sunTimes.geocodeCity("zzzz", respondWith({ generationtime_ms: 0.4 }))).toBeNull();
  });

  it("throws when the service errors", async () => {
    await expect(sunTimes.geocodeCity("Austin", respondWith({}, 500))).rejects.toThrow();
  });
});

describe("loadSunEvents", () => {
  const forecast = { daily: { sunrise: [SUNRISE, null], sunset: [SUNSET, SUNSET + 86400] } };

  it("turns the forecast into ordered events in epoch milliseconds, dropping polar gaps", async () => {
    const fetchMock = respondWith(forecast);

    const events = await sunTimes.loadSunEvents(austin, NOW, fetchMock);

    expect(events).toEqual<SunEvent[]>([
      { at: SUNRISE * 1000, kind: "sunrise" },
      { at: SUNSET * 1000, kind: "sunset" },
      { at: (SUNSET + 86400) * 1000, kind: "sunset" },
    ]);
    const requested = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(requested.searchParams.get("latitude")).toBe("30.26715");
    expect(requested.searchParams.get("timeformat")).toBe("unixtime");
  });

  it("reuses a recent answer instead of asking again", async () => {
    const fetchMock = respondWith(forecast);

    await sunTimes.loadSunEvents(austin, NOW, fetchMock);
    await sunTimes.loadSunEvents(austin, NOW + 60 * 60 * 1000, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one request between simultaneous callers", async () => {
    const fetchMock = respondWith(forecast);

    await Promise.all([
      sunTimes.loadSunEvents(austin, NOW, fetchMock),
      sunTimes.loadSunEvents(austin, NOW, fetchMock),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again once the cached answer is old, and keeps the old one if that fails", async () => {
    const good = await sunTimes.loadSunEvents(austin, NOW, respondWith(forecast));
    const failing = respondWith({}, 503);

    const later = NOW + 7 * 60 * 60 * 1000;
    expect(await sunTimes.loadSunEvents(austin, later, failing)).toEqual(good);
    expect(failing).toHaveBeenCalledTimes(1);

    // The failure backs off instead of retrying on every call.
    expect(await sunTimes.loadSunEvents(austin, later + 60 * 1000, failing)).toEqual(good);
    expect(failing).toHaveBeenCalledTimes(1);
    await sunTimes.loadSunEvents(austin, later + 3 * 60 * 1000, failing);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("returns nothing when it has never succeeded", async () => {
    expect(await sunTimes.loadSunEvents(austin, NOW, respondWith({}, 503))).toEqual([]);
  });
});

describe("resolveSunSchedule", () => {
  it("uses the city's real times once loaded", async () => {
    const fetchMock = respondWith({ daily: { sunrise: [SUNRISE], sunset: [SUNSET] } });

    const schedule = await sunTimes.resolveSunSchedule(austin, NOW, fetchMock);

    expect(schedule).toMatchObject({ estimated: false, retry: false, level: 1 });
  });

  it("uses stand-in times and keeps trying when a saved city can't be loaded", async () => {
    const schedule = await sunTimes.resolveSunSchedule(austin, NOW, respondWith({}, 503));

    expect(schedule).toMatchObject({ estimated: true, retry: true });
    expect(schedule.events).not.toHaveLength(0);
  });

  it("uses stand-in times without asking the network when no city is saved", async () => {
    const fetchMock = respondWith({});

    const schedule = await sunTimes.resolveSunSchedule(undefined, NOW, fetchMock);

    expect(schedule).toMatchObject({ estimated: true, retry: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("todaysSunTimes", () => {
  it("formats today's events on the city's own clock", () => {
    const events: SunEvent[] = [
      { at: (SUNRISE - 86400) * 1000, kind: "sunrise" },
      { at: SUNRISE * 1000, kind: "sunrise" },
      { at: SUNSET * 1000, kind: "sunset" },
      { at: (SUNSET + 86400) * 1000, kind: "sunset" },
    ];

    expect(sunTimes.todaysSunTimes(events, "America/Chicago", NOW)).toEqual({
      sunrise: "6:43 AM",
      sunset: "6:31 PM",
    });
  });

  it("leaves out events that aren't today", () => {
    expect(sunTimes.todaysSunTimes([], "America/Chicago", NOW)).toEqual({});
  });
});
