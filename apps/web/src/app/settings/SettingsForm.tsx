"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EDITOR_FONT_CHOICES, editorFontStack, type EditorFontName } from "@/lib/composition/editorFonts";
import {
  PREVIEW_FONT_CHOICES,
  previewFontStack,
  type PreviewFontName,
} from "@/lib/composition/previewFonts";
import { THEME_CHOICES, type ThemeName } from "@/lib/composition/themes";
import {
  saveEditorFont,
  saveLocation,
  savePreviewFont,
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
  wine: ["#160a0e", "#ecdde0", "#c8405f"],
  cream: ["#f6f0e1", "#3b3226", "#9a4a1f"],
  // Shows the dark and light backgrounds it moves between.
  auto: ["#121212", "#f7f7f4", "#0178d4"],
};

type Props = {
  currentTheme: ThemeName;
  currentPreviewFont: PreviewFontName;
  currentEditorFont: EditorFontName;
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
  currentPreviewFont,
  currentEditorFont,
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
  const [previewFont, setPreviewFont] = useState<PreviewFontName>(currentPreviewFont);
  const [previewFontError, setPreviewFontError] = useState<string>();
  const [, startPreviewFontTransition] = useTransition();
  const [editorFont, setEditorFont] = useState<EditorFontName>(currentEditorFont);
  const [editorFontError, setEditorFontError] = useState<string>();
  const [, startEditorFontTransition] = useTransition();

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

  // Likewise for the preview font: show it straight away, save in the background.
  function selectPreviewFont(next: PreviewFontName) {
    const previous = previewFont;
    setPreviewFont(next);
    setPreviewFontError(undefined);
    document.documentElement.style.setProperty("--preview-font", previewFontStack(next));
    startPreviewFontTransition(async () => {
      const result = await savePreviewFont(next);
      if (result.error) {
        setPreviewFont(previous);
        setPreviewFontError(result.error);
        document.documentElement.style.setProperty("--preview-font", previewFontStack(previous));
      }
    });
  }

  // Same again for the editor font.
  function selectEditorFont(next: EditorFontName) {
    const previous = editorFont;
    setEditorFont(next);
    setEditorFontError(undefined);
    document.documentElement.style.setProperty("--editor-font", editorFontStack(next));
    startEditorFontTransition(async () => {
      const result = await saveEditorFont(next);
      if (result.error) {
        setEditorFont(previous);
        setEditorFontError(result.error);
        document.documentElement.style.setProperty("--editor-font", editorFontStack(previous));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldSet className="gap-2 text-sm">
        <FieldLegend variant="label">Color scheme</FieldLegend>
        <RadioGroup
          value={theme}
          onValueChange={(next) => selectTheme(next as ThemeName)}
          aria-label="Color scheme"
          className="gap-2"
        >
          {THEME_CHOICES.map(({ name, label }) => (
            <Field key={name} orientation="horizontal" className="w-fit gap-3">
              <RadioGroupItem value={name} id={`theme-${name}`} />
              <FieldLabel htmlFor={`theme-${name}`} className="cursor-pointer gap-3 font-normal">
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
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
        {themeError && <FieldError>{themeError}</FieldError>}
      </FieldSet>

      <FieldSet className="gap-2 text-sm">
        <FieldLegend variant="label">Preview font</FieldLegend>
        <FieldDescription className="text-xs">
          The typeface notes are shown in when previewed. Every option is an open-source font
          (SIL Open Font License) bundled with the app.
        </FieldDescription>
        <RadioGroup
          value={previewFont}
          onValueChange={(next) => selectPreviewFont(next as PreviewFontName)}
          aria-label="Preview font"
          className="gap-2"
        >
          {PREVIEW_FONT_CHOICES.map(({ name, label, stack }) => (
            <Field key={name} orientation="horizontal" className="w-fit gap-3">
              <RadioGroupItem value={name} id={`preview-font-${name}`} />
              <FieldLabel
                htmlFor={`preview-font-${name}`}
                className="cursor-pointer gap-3 font-normal"
                style={{ fontFamily: stack }}
              >
                {label}
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
        <p className="preview-text rounded-md border bg-muted/40 px-3 py-2 text-base">
          The quick brown fox jumps over the lazy dog. <em>Pack my box with five dozen liquor jugs.</em>{" "}
          <code className="text-sm">0123456789</code>
        </p>
        {previewFontError && <FieldError>{previewFontError}</FieldError>}
      </FieldSet>

      <FieldSet className="gap-2 text-sm">
        <FieldLegend variant="label">Editor font</FieldLegend>
        <FieldDescription className="text-xs">
          The typeface used while writing in the Markdown tab. Monospace keeps tables and code
          lined up; the proportional fonts read more like prose. Every option is an open-source
          font (SIL Open Font License) bundled with the app.
        </FieldDescription>
        <RadioGroup
          value={editorFont}
          onValueChange={(next) => selectEditorFont(next as EditorFontName)}
          aria-label="Editor font"
          className="gap-2"
        >
          {EDITOR_FONT_CHOICES.map(({ name, label, stack }) => (
            <Field key={name} orientation="horizontal" className="w-fit gap-3">
              <RadioGroupItem value={name} id={`editor-font-${name}`} />
              <FieldLabel
                htmlFor={`editor-font-${name}`}
                className="cursor-pointer gap-3 font-normal"
                style={{ fontFamily: stack }}
              >
                {label}
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
        <p className="editor-text whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm leading-6">
          {"## Meeting notes\n- [ ] Send the **quarterly** summary to `ops@example.com`"}
        </p>
        {editorFontError && <FieldError>{editorFontError}</FieldError>}
      </FieldSet>

      <form action={locationAction} className="flex flex-col gap-2 text-sm">
        <Field className="gap-1">
          <FieldLabel htmlFor="city">City</FieldLabel>
          <FieldDescription className="text-xs">
            Sets the sunrise and sunset that &ldquo;Follow the sun&rdquo; tracks. Try{" "}
            <span className="font-mono">Austin, TX</span>.
          </FieldDescription>
          <Input
            id="city"
            type="text"
            name="city"
            defaultValue={locationState.query ?? currentCity}
            placeholder="Austin, TX"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" variant="outline" size="lg" disabled={locationPending} className="w-fit px-4">
          {locationPending ? "Looking up…" : "Save city"}
        </Button>
        {locationState.error && <FieldError>{locationState.error}</FieldError>}
        {locationState.saved && (
          <p role="status" className="text-success">
            Using {locationState.saved.name}: {formatSunTimes(locationState.saved)}.
          </p>
        )}
        {!locationState.saved && !locationState.error && currentCity && currentSunTimes && (
          <p className="text-muted-foreground">
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
        <Field className="gap-1">
          <FieldLabel htmlFor="appDataDir">Application data directory</FieldLabel>
          <Input
            id="appDataDir"
            type="text"
            name="appDataDir"
            defaultValue={state.appDataDir ?? currentAppDataDir}
            required
            spellCheck={false}
            className="font-mono"
          />
        </Field>

        <Field className="gap-1">
          <FieldLabel htmlFor="dbPath">Database file location</FieldLabel>
          <FieldDescription className="text-xs">
            Optional — leave blank to use{" "}
            <span className="font-mono">{derivedDbPathPlaceholder}</span>
          </FieldDescription>
          <Input
            id="dbPath"
            type="text"
            name="dbPath"
            defaultValue={state.dbPath ?? currentDbPath}
            placeholder={derivedDbPathPlaceholder}
            spellCheck={false}
            className="font-mono"
          />
        </Field>

        {state.error && <FieldError>{state.error}</FieldError>}
        {state.success && (
          <p role="status" className="text-success">
            Saved. Now reading and writing at the location above.
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending} className="w-fit px-4">
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </div>
  );
}
