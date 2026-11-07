"use client";

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import { saveSunPair, saveTheme } from "@/lib/composition/client";
import type { SunPairName } from "@/lib/composition/sunPairs";
import type { ThemeName } from "@/lib/composition/themes";

type ColorScheme = {
  theme: ThemeName;
  themeError?: string;
  selectTheme: (next: ThemeName) => void;
  sunPair: SunPairName;
  sunPairError?: string;
  selectSunPair: (next: SunPairName) => void;
};

const ColorSchemeContext = createContext<ColorScheme | null>(null);

/**
 * The color scheme and, for "Follow the sun", the pair of colors it moves between, shared by the two Settings pages
 * that choose them (Styling, and Follow the sun under it). Like the other Styling choices, one applies to the page as
 * soon as it is picked and is saved in the background; if saving fails, it goes back to what it was.
 */
export function ColorSchemeProvider({
  initialTheme,
  initialSunPair,
  children,
}: {
  initialTheme: ThemeName;
  initialSunPair: SunPairName;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [themeError, setThemeError] = useState<string>();
  const [, startThemeTransition] = useTransition();
  const [sunPair, setSunPair] = useState(initialSunPair);
  const [sunPairError, setSunPairError] = useState<string>();
  const [, startSunPairTransition] = useTransition();

  // Apply the scheme immediately rather than waiting for the server round trip.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  // The pair is an attribute on <html> that globals.css draws from, and that the sun sync reads to know where the
  // ink flips; the sync is told so it moves the page along the new pair at once.
  function selectSunPair(next: SunPairName) {
    const previous = sunPair;
    const root = document.documentElement;
    setSunPair(next);
    setSunPairError(undefined);
    root.dataset.sunPair = next;
    window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
    startSunPairTransition(async () => {
      const result = await saveSunPair(next);
      if (result.error) {
        setSunPair(previous);
        setSunPairError(result.error);
        root.dataset.sunPair = previous;
        window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
      }
    });
  }

  return (
    <ColorSchemeContext.Provider value={{ theme, themeError, selectTheme, sunPair, sunPairError, selectSunPair }}>
      {children}
    </ColorSchemeContext.Provider>
  );
}

export function useColorScheme(): ColorScheme {
  const value = useContext(ColorSchemeContext);
  if (!value) throw new Error("useColorScheme needs a ColorSchemeProvider around it");
  return value;
}
