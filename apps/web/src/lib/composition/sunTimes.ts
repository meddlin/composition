import { fallbackSunEvents, sunLevel, type SunEvent } from "./sunSchedule";

/**
 * City lookup and sunrise/sunset times from Open-Meteo (https://open-meteo.com),
 * which is free for non-commercial use and needs no API key.
 */

export type SavedLocation = {
  /** Display name, e.g. "Austin, Texas, United States". */
  name: string;
  latitude: number;
  longitude: number;
  /** IANA zone, used to show sunrise/sunset in the city's own clock. */
  timezone: string;
};

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 3000;
/** Re-query at most this often; sunrise moves by a minute or two per day. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** After a failed lookup, serve the stale answer for this long before trying again. */
const FAILURE_BACKOFF_MS = 2 * 60 * 1000;

type FetchLike = typeof fetch;

async function getJson(url: URL, fetchImpl: FetchLike): Promise<unknown> {
  const response = await fetchImpl(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Open-Meteo responded with ${response.status}`);
  return response.json();
}

/** Resolves "Austin, TX" to its best match, or null when nothing matches. Throws if the API is unreachable. */
export async function geocodeCity(
  query: string,
  fetchImpl: FetchLike = fetch,
): Promise<SavedLocation | null> {
  const url = new URL(GEOCODING_URL);
  url.search = new URLSearchParams({
    name: query,
    count: "1",
    language: "en",
    format: "json",
  }).toString();

  const data = (await getJson(url, fetchImpl)) as {
    results?: {
      name?: string;
      admin1?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
      timezone?: string;
    }[];
  };
  const match = data.results?.[0];
  if (
    !match ||
    typeof match.name !== "string" ||
    typeof match.latitude !== "number" ||
    typeof match.longitude !== "number" ||
    typeof match.timezone !== "string"
  ) {
    return null;
  }

  const name = [match.name, match.admin1, match.country]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return { name, latitude: match.latitude, longitude: match.longitude, timezone: match.timezone };
}

const cacheKey = (location: SavedLocation) => `${location.latitude},${location.longitude}`;
const cache = new Map<string, { fetchedAt: number; events: SunEvent[] }>();
const inflight = new Map<string, Promise<SunEvent[]>>();

async function fetchSunEvents(location: SavedLocation, fetchImpl: FetchLike): Promise<SunEvent[]> {
  const url = new URL(FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: "sunrise,sunset",
    // Epoch seconds: unambiguous no matter which timezone the city is in.
    timeformat: "unixtime",
    timezone: "auto",
    past_days: "1",
    forecast_days: "3",
  }).toString();

  const data = (await getJson(url, fetchImpl)) as {
    daily?: { sunrise?: unknown[]; sunset?: unknown[] };
  };
  const events: SunEvent[] = [];
  for (const kind of ["sunrise", "sunset"] as const) {
    for (const seconds of data.daily?.[kind] ?? []) {
      // Polar day/night leaves a null for days the sun doesn't rise or set.
      if (typeof seconds === "number" && Number.isFinite(seconds)) {
        events.push({ at: seconds * 1000, kind });
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Sunrise and sunset events around now (yesterday through two days ahead).
 * Answers are cached per location. Returns the last good answer if the API
 * is down, or an empty list if there never was one.
 */
export async function loadSunEvents(
  location: SavedLocation,
  now: number = Date.now(),
  fetchImpl: FetchLike = fetch,
): Promise<SunEvent[]> {
  const key = cacheKey(location);
  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.events;

  let request = inflight.get(key);
  if (!request) {
    request = fetchSunEvents(location, fetchImpl)
      .then((events) => {
        cache.set(key, { fetchedAt: now, events });
        return events;
      })
      .catch(() => {
        // Back off so an offline machine doesn't wait out the timeout on every page load.
        const events = cached?.events ?? [];
        cache.set(key, { fetchedAt: now - CACHE_TTL_MS + FAILURE_BACKOFF_MS, events });
        return events;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
  }
  return request;
}

export type SunSchedule = {
  events: SunEvent[];
  /** How light the app should be at `now`, 0 (dark) to 1 (light). */
  level: number;
  /** True when `events` are stand-ins rather than real times for the saved city. */
  estimated: boolean;
  /** Worth asking the server again soon: a city is saved but its times couldn't be loaded. */
  retry: boolean;
};

function scheduleFrom(
  events: SunEvent[],
  location: SavedLocation | undefined,
  now: number,
): SunSchedule {
  if (events.length === 0) {
    const standIn = fallbackSunEvents(now);
    return { events: standIn, level: sunLevel(standIn, now), estimated: true, retry: Boolean(location) };
  }
  return { events, level: sunLevel(events, now), estimated: false, retry: false };
}

export async function resolveSunSchedule(
  location: SavedLocation | undefined,
  now: number = Date.now(),
  fetchImpl: FetchLike = fetch,
): Promise<SunSchedule> {
  const events = location ? await loadSunEvents(location, now, fetchImpl) : [];
  return scheduleFrom(events, location, now);
}

/** Like `resolveSunSchedule` but only from what's already cached, never the network. For first paint. */
export function cachedSunSchedule(
  location: SavedLocation | undefined,
  now: number = Date.now(),
): SunSchedule {
  const events = location ? (cache.get(cacheKey(location))?.events ?? []) : [];
  return scheduleFrom(events, location, now);
}

/** The sunrise and sunset that fall on today's date in the city's own timezone, if known. */
export function todaysSunTimes(
  events: readonly SunEvent[],
  timezone: string,
  now: number = Date.now(),
): { sunrise?: string; sunset?: string } {
  const dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const today = dateKey.format(now);
  const result: { sunrise?: string; sunset?: string } = {};
  for (const event of events) {
    if (dateKey.format(event.at) === today) result[event.kind] = clock.format(event.at);
  }
  return result;
}
