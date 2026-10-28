"use client";

import { useEffect, useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { isTranslucent, type WindowTranslucency } from "@/lib/composition/windowApi";
import {
  getWindowTranslucency,
  setWindowTranslucency,
  WINDOW_SETTINGS_AVAILABLE,
} from "@/lib/composition/windowClient";

/** The attribute on <html> that makes the stylesheet's surfaces see-through (see globals.css). */
function showTranslucent(state: WindowTranslucency) {
  document.documentElement.toggleAttribute("data-translucent", isTranslucent(state));
}

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
      {error && <FieldError>{error}</FieldError>}
    </FieldSet>
  );
}
