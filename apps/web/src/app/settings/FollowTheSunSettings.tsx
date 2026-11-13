"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { saveSunHours } from "@/lib/composition/client";
import {
  DEFAULT_SUN_HOURS,
  SUN_HOUR_KEYS,
  SUN_HOUR_LABELS,
  validateSunHours,
  type SunHours,
} from "@/lib/composition/sunHours";
import { SUN_PAIR_CHOICES, inkFlipLevelOf, type SunPairName } from "@/lib/composition/sunPairs";
import { MS_PER_MINUTE, levelAtTimeOfDay, toneForLevel } from "@/lib/composition/sunSchedule";
import { useColorScheme } from "./ColorSchemeProvider";

const SECTION_TITLE = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** The levels a pair is shown at, from full day to full night: a level is how light the page is (see sunSchedule.ts). */
const PREVIEW_LEVELS = [1, 0.83, 0.66, 0.5, 0.34, 0.17, 0];

type Props = {
  /** The hours saved now. */
  currentHours: SunHours;
};

/** The cells of the day strip: one per hour, each drawn at the middle of its hour. */
const DAY_CELLS = Array.from({ length: 24 }, (_, hour) => hour);

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
 * The whole day, from midnight to midnight, in the chosen pair's colors at the level the hours make of each hour of it, so the
 * hours can be judged by eye. Drawn like `SunStrip`, by the stylesheet's own rules, with nothing here to keep in step with them.
 */
function DayStrip({ pair, hours }: { pair: SunPairName; hours: SunHours }) {
  const flip = inkFlipLevelOf(pair);
  return (
    <div aria-hidden className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span className="flex overflow-hidden rounded-md ring-1 ring-foreground/15">
        {DAY_CELLS.map((hour) => {
          const level = levelAtTimeOfDay(hours, (hour * 60 + 30) * MS_PER_MINUTE);
          return (
            <span
              key={hour}
              data-theme="auto"
              data-sun-pair={pair}
              data-tone={toneForLevel(level, flip)}
              className="grid h-7 flex-1 place-items-center text-[10px] font-medium"
              style={{ "--auto-light": `${level * 100}%`, backgroundColor: "var(--background)", color: "var(--foreground)" } as CSSProperties}
            >
              <span className="hidden sm:inline">Aa</span>
            </span>
          );
        })}
      </span>
      <span className="flex justify-between">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </span>
    </div>
  );
}

/**
 * Settings > Styling > Follow the sun: what the color scheme of that name does, which pair of light and dark colors it
 * moves between, and the four hours, set by hand, at which it gets lighter and darker.
 */
export function FollowTheSunSettings({ currentHours }: Props) {
  const { theme, themeError, selectTheme, sunPair, sunPairError, selectSunPair } = useColorScheme();
  const [saved, setSaved] = useState(currentHours);
  const [draft, setDraft] = useState(currentHours);
  const [result, setResult] = useState<{ error?: string; savedAt?: true }>({});
  const [pending, startSave] = useTransition();

  const checked = useMemo(() => validateSunHours(draft), [draft]);
  const changed = SUN_HOUR_KEYS.some((key) => draft[key] !== saved[key]);
  const isDefault = SUN_HOUR_KEYS.every((key) => draft[key] === DEFAULT_SUN_HOURS[key]);

  function edit(key: keyof SunHours, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setResult({});
  }

  function save() {
    if (!checked.hours) return;
    const hours = checked.hours;
    startSave(async () => {
      const outcome = await saveSunHours(hours);
      if (outcome.error) return setResult({ error: outcome.error });
      setSaved(hours);
      setDraft(hours);
      setResult({ savedAt: true });
      window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
    });
  }

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
            Follow the sun is a color scheme that moves with the day: light colors by day, dark colors at night, and a fade
            between.
          </p>
          <p>
            You say when. Set the four times below on this computer&apos;s clock: when the page starts getting lighter, when it is
            fully light, when it starts getting darker and when it is fully dark. Between each pair the colors ease through the
            steps of the strips below; the rest of the time they hold. The text changes between its light-scheme and dark-scheme
            color halfway through a fade, so it stays readable all the way.
          </p>
          <p>Nothing is looked up: there is no city, no location and no network request.</p>
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
            the evening fade goes on.
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
            When it changes
          </CardTitle>
          <CardDescription>
            Times on this computer&apos;s own clock, so they follow it if it changes zone. They go once round the clock in order,
            starting anywhere (to be light over the night, start in the evening), each at least a minute after the one before.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {SUN_HOUR_KEYS.map((key) => (
                <Field key={key} className="gap-1">
                  <FieldLabel htmlFor={`sun-hour-${key}`}>{SUN_HOUR_LABELS[key]}</FieldLabel>
                  <Input
                    id={`sun-hour-${key}`}
                    type="time"
                    name={key}
                    value={draft[key]}
                    required
                    aria-invalid={checked.error !== undefined}
                    aria-describedby={checked.error ? "sun-hours-error" : undefined}
                    onChange={(event) => edit(key, event.target.value)}
                    className="w-fit"
                  />
                </Field>
              ))}
            </div>

            <DayStrip pair={sunPair} hours={checked.hours ?? saved} />
            <FieldDescription className="text-xs">
              The day from midnight to midnight, in the colors above. It shows the hours as typed once they go round in order.
            </FieldDescription>

            {checked.error && (
              <FieldError id="sun-hours-error" role="alert">
                {checked.error}
              </FieldError>
            )}
            {result.error && <FieldError role="alert">{result.error}</FieldError>}
            {result.savedAt && !changed && (
              <p role="status" className="text-success">
                Saved.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" size="lg" disabled={pending || !checked.hours || !changed} className="px-4">
                {pending ? "Saving…" : "Save hours"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={pending || isDefault}
                onClick={() => {
                  setDraft(DEFAULT_SUN_HOURS);
                  setResult({});
                }}
                className="px-4"
              >
                Use the defaults
              </Button>
            </div>
            <FieldDescription className="text-xs">
              The defaults are 05:45, 07:15, 17:45 and 19:15: a 90-minute fade up to full light, and another down to full dark.
            </FieldDescription>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
