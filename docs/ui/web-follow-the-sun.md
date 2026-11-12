# The "Follow the sun" color scheme

Source: [`sunHours.ts`](../../apps/web/src/lib/composition/sunHours.ts),
[`sunSchedule.ts`](../../apps/web/src/lib/composition/sunSchedule.ts),
[`SunThemeSync.tsx`](../../apps/web/src/components/SunThemeSync.tsx),
[`FollowTheSunSettings.tsx`](../../apps/web/src/app/settings/FollowTheSunSettings.tsx),
[`layout.tsx`](../../apps/web/src/app/layout.tsx),
[`layout.desktop.tsx`](../../apps/web/src/app/layout.desktop.tsx),
[`globals.css`](../../apps/web/src/app/globals.css)

A color scheme, chosen in Settings like the others, that is dark at night and light by day and eases between the two at
**four hours you set by hand**. Available in the web and desktop apps, and in the CLI and the iPad app (see
[the feature matrix](../feature-matrix.md)). Nothing is looked up: there is no city, no location and no network request.
(Until 2026-11-12 it followed a saved city's sunrise and sunset, from Open-Meteo. The redesign, and why, is in
[the iPad build plan](../ipad-build-plan.md#between-m2-and-m3-the-follow-the-sun-redesign).)

## Setting it up

1. Settings → Color scheme → **Follow the sun** (or **Use Follow the sun** on its own page).
2. Settings → Styling → Follow the sun → **When it changes**: set the four times and press **Save hours**.

| Hour | What happens |
|---|---|
| **Starts getting lighter** | The page begins to ease from dark toward light. |
| **Fully light from** | The fade is over; it stays fully light until the next hour. |
| **Starts getting darker** | The page begins to ease from light toward dark. |
| **Fully dark from** | The fade is over; it stays fully dark until *Starts getting lighter*. |

The defaults are **05:45, 07:15, 17:45 and 19:15** (a 90-minute fade up to full light and another down to full dark), which is
exactly what the scheme did before the hours were the person's, with no city saved.

The times are on the device's own wall clock: no time zone is stored, so they follow the computer if its zone changes, and
a day with a clock change keeps the same hours. Hours and minutes (`HH:MM`, 24-hour); the input shows the browser's own
12- or 24-hour style.

**The rule.** The four go **once round the clock in order, starting anywhere**, each at least a minute after the one before
(one minute is a near-instant switch). To be light over the night, start in the evening (`19:00 20:00 05:00 06:00`); a fade may
cross midnight. A set that does not go round in order, or has text that is not a time, is refused with a reason and nothing is
saved: the Save button is off while the four are not in order, with the reason under them. The page also draws **the day
from midnight to midnight** in the chosen pair's colors, so the hours can be judged by eye.

The hours are stored as `sunHours` in `~/.composition-web/settings.json` (and the desktop's own `settings.json`):

```json
"sunHours": { "lightenFrom": "05:45", "lightFrom": "07:15", "darkenFrom": "17:45", "darkFrom": "19:15" }
```

A value that is not all four valid `HH:MM` strings in order round the clock is read as the defaults (all or nothing: a
half-valid set does not describe a day). A saved city (`location`) from an older version is **not read and is gone the next
time settings are written**; a backup that holds one still restores, and the city is dropped. An older build that restores a
backup with `sunHours` in it does not know the key and runs on its stand-in times.

## Across the web and desktop builds

Two `CompositionApi` methods carry it (see [`api.ts`](../../apps/web/src/lib/composition/api.ts)):
`saveSunHours(hours)`, which validates and saves, and `loadSunHours()`, which returns the hours for the `auto` scheme or `null`
when another scheme is selected. Both end in `service.ts`. The settings snapshot (`loadSettings()`) carries `sunHours` too.

First paint is synchronous, since nothing waits on a network. The web layout renders the attributes below from the saved
hours. The desktop preload snapshot (`initial.sun`) carries them, and `layout.desktop.tsx` applies them before the page paints;
the window background starts as the matching dark or light end of the ramp. `SunThemeSync` then loads the hours and takes over.

## How the transition works

`sunLevel(hours, now)` is a level from 0 (dark) to 1 (light) and a **function of the time of day on the wall clock alone**.
Measured forward from *Starts getting lighter*, it eases (a smoothstep) from 0 to 1 over the span to *Fully light from*, holds 1
to *Starts getting darker*, eases back to 0 over the span to *Fully dark from*, and holds 0 round to the start. It is computed in
whole milliseconds, so the Swift port gets the same level to the last bit.

The layout renders `data-theme="auto"`, `data-tone` (`light` or `dark`) and a `--auto-light` percentage on `<html>` for the
current moment, so there's no flash on load. `SunThemeSync` then updates those two every 30 seconds while the page is open.
Settings dispatches `SUN_SETTINGS_CHANGED` after the scheme, the pair or the hours are saved, so a change applies without a
reload (and the desktop tells every window).

In `globals.css`:

- **Surfaces** (`--background`, `--surface`, `--panel`) cross-fade between the dark and
  light values with `color-mix` and `--auto-light`.
- **Everything else** (text, accents, code colors) takes the dark or light palette outright,
  switching at the pair's flip level (0.45 for the classic pair). A blend of dark and light text is unreadable
  on the half-way background, so text changes in one step instead of fading.

The blend endpoints duplicate values from the dark and light palettes; `themes.test.ts`
fails if they drift apart.

## What checks it

[`sunConformance.test.ts`](../../apps/web/src/lib/composition/sunConformance.test.ts) writes
[`fixtures/conformance/sun.json`](../../fixtures/conformance/README.md): `HH:MM` read and written, which sets of hours are accepted,
refused (with the words) or read as the defaults, the level at 7,376 moments over 111 sets of hours, at every edge of a fade and between, the
tone and the `--auto-light` text, the time of day in fourteen zones across their clock changes, and every pair's palette. The
iPad's Swift core replays it ([architecture/appearance.md](../architecture/appearance.md)).
