"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { THEME_CHOICES, type ThemeName } from "@/lib/composition/themes";
import { saveSettingsAction, saveThemeAction, type SettingsFormState } from "./actions";

// Preview swatches (background, foreground, primary); must match the palettes in globals.css.
const THEME_SWATCHES: Record<ThemeName, [string, string, string]> = {
  dark: ["#121212", "#e0e0e0", "#0178d4"],
  light: ["#f7f7f4", "#24292f", "#0b62d6"],
  forest: ["#0c1510", "#d5e5da", "#3fb876"],
};

type Props = {
  currentTheme: ThemeName;
  currentAppDataDir: string;
  currentDbPath: string;
  derivedDbPathPlaceholder: string;
};

const initialState: SettingsFormState = {};

export function SettingsForm({
  currentTheme,
  currentAppDataDir,
  currentDbPath,
  derivedDbPathPlaceholder,
}: Props) {
  const [state, formAction, pending] = useActionState(saveSettingsAction, initialState);
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
      const result = await saveThemeAction(next);
      if (result.error) {
        setTheme(previous);
        setThemeError(result.error);
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
