# The "Follow the sun" color scheme

Source: [`sunSchedule.ts`](../../apps/web/src/lib/composition/sunSchedule.ts),
[`sunTimes.ts`](../../apps/web/src/lib/composition/sunTimes.ts),
[`SunThemeSync.tsx`](../../apps/web/src/components/SunThemeSync.tsx),
[`layout.tsx`](../../apps/web/src/app/layout.tsx),
[`layout.desktop.tsx`](../../apps/web/src/app/layout.desktop.tsx),
[`globals.css`](../../apps/web/src/app/globals.css)

A fifth color scheme, chosen in Settings like the others, that is dark at night and light
by day and eases between the two around the sunrise and sunset of a saved city. Available
in the web and desktop apps; the CLI has no counterpart.

## Setting it up

1. Settings → Color scheme → **Follow the sun**.
2. Enter a city under **City** (`Austin, TX`, `Paris`, `Springfield, Illinois`) and press
   **Save city**. The page confirms what it matched and today's sunrise and sunset there.
   Clearing the field forgets the city.

The city is stored as `location` (name, latitude, longitude, IANA timezone) in
`~/.composition-web/settings.json`.

## Where the times come from

[Open-Meteo](https://open-meteo.com): free for non-commercial use, no API key.

- **Geocoding** (`geocoding-api.open-meteo.com`) runs once, when the city is saved. The
  first match wins, so ambiguous names need a qualifier.
- **Sunrise/sunset** (`api.open-meteo.com`) returns yesterday through two days ahead as
  epoch seconds. The server caches it per location for 6 hours, shares one request between
  concurrent renders, and after a failure serves the last good answer and waits 2 minutes
  before trying again (so being offline doesn't add a timeout to every page load).

If no city is saved, or the times have never loaded, the scheme runs on stand-in times of
6:30 AM and 6:30 PM local time, and the page keeps retrying every 10 minutes when a city
is saved.

## Across the web and desktop builds

Two `CompositionApi` methods carry it (see [`api.ts`](../../apps/web/src/lib/composition/api.ts)):
`saveLocation(city)` and `loadSunSchedule()`, which returns the events for the `auto` scheme
or `null` when another scheme is selected. Both end in `service.ts`, so the Open-Meteo
requests happen on the server (web) or in Electron's main process (desktop), never in the
page.

First paint can't wait for the network. The web layout awaits the schedule and renders the
attributes below. The desktop preload snapshot (`initial.sun`) carries them from whatever
times are cached, else the stand-ins, and `layout.desktop.tsx` applies them before the
page paints; the window background starts as the matching dark or light end of the ramp.
`SunThemeSync` then loads the real schedule and corrects course.

## How the transition works

`sunLevel` turns the events into a level from 0 (dark) to 1 (light). Around each sunrise
the level eases up over a 90-minute window (45 minutes either side); around each sunset it
eases back down. Outside the windows it holds at 0 or 1.

The layout renders `data-theme="auto"`, `data-tone` (`light` or `dark`) and a
`--auto-light` percentage on `<html>` for the current moment, so there's no flash on load.
`SunThemeSync` then updates those two every 30 seconds while the page is open, and calls
`loadSunSchedule()` again when the times it has run out or were only estimates. Settings
dispatches `SUN_SETTINGS_CHANGED` after the scheme or city is saved, so a change applies
without a reload.

In `globals.css`:

- **Surfaces** (`--background`, `--surface`, `--panel`) cross-fade between the dark and
  light values with `color-mix` and `--auto-light`.
- **Everything else** (text, accents, code colors) takes the dark or light palette outright,
  switching when the level crosses 0.45. A blend of dark and light text is unreadable on
  the half-way background, so text changes in one step instead of fading.

The blend endpoints duplicate values from the dark and light palettes; `themes.test.ts`
fails if they drift apart.
