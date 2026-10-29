"use client";

import { useEffect, useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { isTranslucent, MIN_WINDOW_OPACITY, type WindowTranslucency } from "@/lib/composition/windowApi";
import { applyWindowOpacity } from "@/lib/composition/windowOpacity";
import {
  getWindowTranslucency,
  setWindowOpacity,
  setWindowTranslucency,
  WINDOW_SETTINGS_AVAILABLE,
} from "@/lib/composition/windowClient";

/** The attribute on <html> that makes the stylesheet's surfaces see-through (see globals.css). */
function showTranslucent(state: WindowTranslucency) {
  document.documentElement.toggleAttribute("data-translucent", isTranslucent(state));
  applyWindowOpacity(document.documentElement, state.opacity);
}

/** The slider speaks of transparency; the stylesheet and the saved setting, of opacity. */
const toTransparencyPercent = (opacity: number) => Math.round((1 - opacity) * 100);
const toOpacity = (transparencyPercent: number) => 1 - transparencyPercent / 100;

/**
 * The window's see-through look. Desktop only, and only where the OS can blur what is behind
 * the window (macOS): everywhere else this renders nothing.
 */
export function WindowSettings() {
  const [state, setState] = useState<WindowTranslucency>();
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!WINDOW_SETTINGS_AVAILABLE) return;
    let cancelled = false;
    getWindowTranslucency().then(
      (loaded) => !cancelled && setState(loaded),
      (failure: unknown) => !cancelled && setError(failure instanceof Error ? failure.message : String(failure)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!WINDOW_SETTINGS_AVAILABLE) return null;
  if (state && !state.supported) return null;

  // Applies straight away; the main process blurs the window and the page lets it show through.
  function select(enabled: boolean) {
    setError(undefined);
    startTransition(async () => {
      try {
        const next = await setWindowTranslucency(enabled);
        setState(next);
        showTranslucent(next);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    });
  }

  // The page follows the thumb as it moves; the setting is saved (and other windows told) when it is let go.
  function preview(percent: number) {
    const opacity = toOpacity(percent);
    setState((current) => current && { ...current, opacity });
    applyWindowOpacity(document.documentElement, opacity);
  }

  function commit(percent: number) {
    setError(undefined);
    startTransition(async () => {
      try {
        const next = await setWindowOpacity(toOpacity(percent));
        setState(next);
        showTranslucent(next);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    });
  }

  return (
    <FieldSet className="gap-2 text-sm">
      <FieldLegend variant="label">Window</FieldLegend>
      <FieldDescription className="text-xs">
        Lets the desktop behind the window show through, blurred, like other macOS apps. Turn it off for a solid
        window. macOS also makes it solid on its own when Reduce transparency is on in System Settings.
      </FieldDescription>
      <Field orientation="horizontal" className="w-fit gap-3">
        <Checkbox
          id="window-translucent"
          checked={state?.enabled ?? false}
          disabled={!state}
          onCheckedChange={(checked) => select(checked === true)}
        />
        <FieldLabel htmlFor="window-translucent" className="cursor-pointer font-normal">
          Translucent window
        </FieldLabel>
      </Field>
      <Field className="w-64 gap-2">
        <div className="flex justify-between">
          <span aria-hidden>Transparency</span>
          <span className="tabular-nums text-muted-foreground">
            {state ? `${toTransparencyPercent(state.opacity)}%` : ""}
          </span>
        </div>
        <Slider
          aria-label="Transparency"
          min={0}
          max={Math.round((1 - MIN_WINDOW_OPACITY) * 100)}
          step={1}
          value={[state ? toTransparencyPercent(state.opacity) : 0]}
          disabled={!state || !state.enabled}
          onValueChange={([percent]) => preview(percent)}
          onValueCommit={([percent]) => commit(percent)}
        />
        <FieldDescription className="text-xs">Recommended: 70%.</FieldDescription>
      </Field>
      {error && <FieldError>{error}</FieldError>}
    </FieldSet>
  );
}
