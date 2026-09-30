"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import { THEME_CHOICES, type ThemeName } from "@/lib/composition/themes";
import {
  saveLocation,
  saveSettings,
  saveTheme,
  type SaveLocationResult,
  type SaveSettingsResult,
} from "@/lib/composition/client";

// Preview swatches (background, foreground, primary); must match the palettes in globals.css.
const THEME_SWATCHES: Record<ThemeName, [string, string, string]> = {
  dark: ["#121212", "#e0e0e0", "#0178d4"],
  light: ["#f7f7f4", "#24292f", "#0b62d6"],
  forest: ["#0c1510", "#d5e5da", "#3fb876"],
  cream: ["#f6f0e1", "#3b3226", "#9a4a1f"],
  // Shows the dark and light backgrounds it moves between.
  auto: ["#121212", "#f7f7f4", "#0178d4"],
};

type Props = {
  currentTheme: ThemeName;
  currentCity: string;
  /** Today's times at the saved city, so the page can confirm the lookup worked. */
  currentSunTimes?: { sunrise?: string; sunset?: string };
  currentAppDataDir: string;
  currentDbPath: string;
  derivedDbPathPlaceholder: string;
};

const initialState: SaveSettingsResult = {};

/** The result of the last city save, plus what to show in the field afterwards. */
type LocationState = SaveLocationResult & { query?: string };

function formatSunTimes(times: { sunrise?: string; sunset?: string }): string {
  const parts = [
    times.sunrise && `sunrise ${times.sunrise}`,
    times.sunset && `sunset ${times.sunset}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "the sun doesn't rise or set there today";
}

async function saveLocationFromForm(
  _previous: LocationState,
  formData: FormData,
): Promise<LocationState> {
  const city = String(formData.get("city") ?? "");
  const result = await saveLocation(city);
  // After an error keep what was typed; after a save, show the matched name.
  const query = result.saved?.name ?? (result.error ? city : "");
  if (!result.error) window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
  return { ...result, query };
}

function saveSettingsFromForm(_previous: SaveSettingsResult, formData: FormData) {
  return saveSettings({
    appDataDir: String(formData.get("appDataDir") ?? ""),
    dbPath: String(formData.get("dbPath") ?? ""),
  });
}

export function SettingsForm({
  currentTheme,
  currentCity,
  currentSunTimes,
  currentAppDataDir,
  currentDbPath,
  derivedDbPathPlaceholder,
}: Props) {
  const [state, formAction, pending] = useActionState(saveSettingsFromForm, initialState);
  const [locationState, locationAction, locationPending] = useActionState(
    saveLocationFromForm,
    {} as LocationState,
  );
  const [theme, setTheme] = useState<ThemeName>(currentTheme);
  const [themeError, setThemeError] = useState<string>();
  const [, startThemeTransition] = useTransition();

  // Apply the scheme immediately rather than waiting for the server round trip.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Like the CLI, a scheme applies and saves as soon as it's picked,
  // independent of the location fields below.
  function selectTheme(next: ThemeName) {
    const previous = theme;
    setTheme(next);
    setThemeError(undefined);
    startThemeTransition(async () => {
      const result = await saveTheme(next);
      if (result.error) {
        setTheme(previous);
        setThemeError(result.error);
      } else {
        // "auto" takes its starting point from the sun times; tell it to load them.
        window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Color scheme</legend>
        {THEME_CHOICES.map(({ name, label }) => (
          <label key={name} className="flex w-fit cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="theme"
              value={name}
              checked={theme === name}
              onChange={() => selectTheme(name)}
              className="accent-primary"
            />
            <span>{label}</span>
            <span aria-hidden className="flex -space-x-1">
              {THEME_SWATCHES[name].map((color, i) => (
                <span
                  key={i}
                  className="size-4 rounded-full border border-foreground/20"
                  style={{ backgroundColor: color }}
                />
              ))}
            </span>
          </label>
        ))}
        {themeError && (
          <p role="alert" className="text-error">
            {themeError}
          </p>
        )}
      </fieldset>

      <form action={locationAction} className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">City</span>
          <span className="text-xs text-foreground/50">
            Sets the sunrise and sunset that &ldquo;Follow the sun&rdquo; tracks. Try{" "}
            <span className="font-mono">Austin, TX</span>.
          </span>
          <input
            type="text"
            name="city"
            defaultValue={locationState.query ?? currentCity}
            placeholder="Austin, TX"
            spellCheck={false}
            className="rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
        </label>
        <button
          type="submit"
          disabled={locationPending}
          className="w-fit rounded-md border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:bg-foreground/10 disabled:opacity-50"
        >
          {locationPending ? "Looking up…" : "Save city"}
        </button>
        {locationState.error && (
          <p role="alert" className="text-error">
            {locationState.error}
          </p>
        )}
        {locationState.saved && (
          <p role="status" className="text-success">
            Using {locationState.saved.name}: {formatSunTimes(locationState.saved)}.
          </p>
        )}
        {!locationState.saved && !locationState.error && currentCity && currentSunTimes && (
          <p className="text-foreground/60">
            Using {currentCity}: {formatSunTimes(currentSunTimes)}.
          </p>
        )}
        {theme === "auto" && !currentCity && !locationState.saved && (
          <p className="text-warning">
            No city saved yet, so &ldquo;Follow the sun&rdquo; is using 6:30 AM and 6:30 PM.
          </p>
        )}
      </form>

      <form action={formAction} className="flex flex-col gap-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Application data directory</span>
          <input
            type="text"
            name="appDataDir"
            defaultValue={state.appDataDir ?? currentAppDataDir}
            required
            spellCheck={false}
            className="rounded-md border border-foreground/15 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-foreground/40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium">Database file location</span>
          <span className="text-xs text-foreground/50">
            Optional — leave blank to use{" "}
            <span className="font-mono">{derivedDbPathPlaceholder}</span>
          </span>
          <input
            type="text"
            name="dbPath"
            defaultValue={state.dbPath ?? currentDbPath}
            placeholder={derivedDbPathPlaceholder}
            spellCheck={false}
            className="rounded-md border border-foreground/15 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-foreground/40"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-error">
            {state.error}
          </p>
        )}
        {state.success && (
          <p role="status" className="text-success">
            Saved. Now reading and writing at the location above.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
