"use client";

import { useActionState, type CSSProperties } from "react";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { saveLocation, type SaveLocationResult } from "@/lib/composition/client";
import { SUN_PAIR_CHOICES, inkFlipLevelOf, type SunPairName } from "@/lib/composition/sunPairs";
import { RAMP_HALF_WIDTH_MS, toneForLevel } from "@/lib/composition/sunSchedule";
import { useColorScheme } from "./ColorSchemeProvider";

const SECTION_TITLE = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

const HALF_RAMP_MINUTES = RAMP_HALF_WIDTH_MS / 60_000;

/** The levels a pair is shown at, from full day to full night: a level is how light the page is (see sunSchedule.ts). */
const PREVIEW_LEVELS = [1, 0.83, 0.66, 0.5, 0.34, 0.17, 0];

type Props = {
  currentCity: string;
  /** Today's times at the saved city, so the page can confirm the lookup worked. */
  currentSunTimes?: { sunrise?: string; sunset?: string };
};

/** The result of the last city save, plus what to show in the field afterwards. */
type LocationState = SaveLocationResult & { query?: string };

function formatSunTimes(times: { sunrise?: string; sunset?: string }): string {
  const parts = [times.sunrise && `sunrise ${times.sunrise}`, times.sunset && `sunset ${times.sunset}`].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "the sun doesn't rise or set there today";
}

async function saveLocationFromForm(_previous: LocationState, formData: FormData): Promise<LocationState> {
  const city = String(formData.get("city") ?? "");
  const result = await saveLocation(city);
  // After an error keep what was typed; after a save, show the matched name.
  const query = result.saved?.name ?? (result.error ? city : "");
  if (!result.error) window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
  return { ...result, query };
}

/**
 * A day in a pair's colors, from full light to full dark. Each cell is drawn by the stylesheet's own rules for that
 * pair at that point of the fade (the attributes the page itself carries when it follows the sun), so it shows what the
 * app will look like, with nothing here to keep in step with the palettes.
 */
function SunStrip({ pair }: { pair: SunPairName }) {
  const flip = inkFlipLevelOf(pair);
  return (
    <span aria-hidden className="flex items-center gap-2 text-xs text-muted-foreground">
      day
      <span className="flex overflow-hidden rounded-md ring-1 ring-foreground/15">
        {PREVIEW_LEVELS.map((level) => (
          <span
            key={level}
            data-theme="auto"
            data-sun-pair={pair}
            data-tone={toneForLevel(level, flip)}
            className="grid h-7 w-8 place-items-center text-xs font-medium"
            // Straight from the palette variables: the translucent window's glass colors (set on the root) don't apply here.
            style={{ "--auto-light": `${level * 100}%`, backgroundColor: "var(--background)", color: "var(--foreground)" } as CSSProperties}
          >
            Aa
          </span>
        ))}
      </span>
      night
    </span>
  );
}

/**
 * Settings > Styling > Follow the sun: what the color scheme of that name does, which pair of light and dark colors it
 * moves between, and the city its sunrise and sunset are taken from.
 */
export function FollowTheSunSettings({ currentCity, currentSunTimes }: Props) {
  const { theme, themeError, selectTheme, sunPair, sunPairError, selectSunPair } = useColorScheme();
  const [locationState, locationAction, locationPending] = useActionState(saveLocationFromForm, {} as LocationState);

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
            What it does
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p>
            Follow the sun is a color scheme that moves with the day where you live: light colors while the sun is up, and
            dark colors once it has set.
          </p>
          <p>
            It never switches all at once. The colors fade across {HALF_RAMP_MINUTES * 2} minutes around each sunrise and
            each sunset, starting {HALF_RAMP_MINUTES} minutes before the sun rises or sets and finishing {HALF_RAMP_MINUTES}{" "}
            minutes after it. The text changes between its light-scheme and dark-scheme color halfway through the fade, so
            it stays readable all the way.
          </p>
          <p>
            To know when the sun rises and sets it needs your city, below. Until one is saved it uses 6:30 AM and 6:30 PM.
          </p>
          {theme === "auto" ? (
            <p role="status" className="text-success">
              Follow the sun is your color scheme now.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="lg" className="px-4" onClick={() => selectTheme("auto")}>
                Use Follow the sun
              </Button>
              <span className="text-muted-foreground">It isn&apos;t your color scheme now; these settings wait until it is.</span>
            </div>
          )}
          {themeError && <FieldError>{themeError}</FieldError>}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
            Light and dark colors
          </CardTitle>
          <CardDescription>
            The two sets of colors it fades between. Each strip runs from full day to full night, the way the page looks as
            the sun sets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={sunPair}
            onValueChange={(next) => selectSunPair(next as SunPairName)}
            aria-label="Light and dark colors"
            className="gap-4"
          >
            {SUN_PAIR_CHOICES.map(({ name, label }) => (
              <Field key={name} orientation="horizontal" className="items-start gap-3">
                <RadioGroupItem value={name} id={`sun-pair-${name}`} className="mt-0.5" />
                <FieldLabel htmlFor={`sun-pair-${name}`} className="cursor-pointer flex-col items-start gap-1.5 text-left font-normal">
                  <span>{label}</span>
                  <SunStrip pair={name} />
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
          {sunPairError && <FieldError className="mt-2">{sunPairError}</FieldError>}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
            Your city
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={locationAction} className="flex flex-col gap-2 text-sm">
            <Field className="gap-1">
              <FieldLabel htmlFor="city">City</FieldLabel>
              <FieldDescription className="text-xs">
                Sets the sunrise and sunset that Follow the sun tracks. Try <span className="font-mono">Austin, TX</span>.
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
            {!currentCity && !locationState.saved && (
              <p className={theme === "auto" ? "text-warning" : "text-muted-foreground"}>
                No city saved yet, so Follow the sun is using 6:30 AM and 6:30 PM.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </>
  );
}
