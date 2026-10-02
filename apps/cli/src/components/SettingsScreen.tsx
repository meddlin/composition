import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import { expandHome, themes, type SettingsSnapshot, type ThemeName } from "../backend";
import { actionFor, footerFor } from "../keymap";
import type { Palette } from "../theme";

type Field = "path" | "theme" | "city";
const FIELDS: Field[] = ["path", "theme", "city"];

type SettingsScreenProps = {
  api: Api;
  palette: Palette;
  width: number;
  theme: string;
  onThemeChange: (theme: ThemeName) => void;
  /** The saved city changed: "follow the sun" should look its times up again. */
  onCityChanged: () => void;
  /** Moves every file to a new folder and reopens it there; absent where that can't be done. */
  moveDataLocation?: (destination: string) => Promise<void>;
  /** Called after the data has moved, so the workspace can load it again. */
  onDataMoved: () => void;
  onClose: () => void;
};

function Section({ title, focused, palette, height, children }: {
  title: string;
  focused: boolean;
  palette: Palette;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <box
      border
      borderStyle="single"
      borderColor={focused ? palette.borderFocused : palette.border}
      title={` ${title} `}
      height={height}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      {children}
    </box>
  );
}

/**
 * Where the data lives, which color scheme to use, and the city "follow the sun" uses.
 * Tab moves between the three; Enter saves or applies the one you are on.
 */
export function SettingsScreen({ api, palette, width, theme, onThemeChange, onCityChanged, moveDataLocation, onDataMoved, onClose }: SettingsScreenProps) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [field, setField] = useState<Field>("path");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("");
  const [city, setCity] = useState("");
  // The inputs' own submit argument is typed loosely; what was typed is tracked here instead.
  const typedPath = useRef("");
  const typedCity = useRef("");

  const load = async () => {
    const next = await api.loadSettings();
    setSnapshot(next);
    return next;
  };
  useEffect(() => {
    void load().then((first) => {
      setPath(first.appDataDir);
      typedPath.current = first.appDataDir;
      setCity(first.city);
      typedCity.current = first.city;
    });
  }, []);

  const fail = (error: unknown) => setMessage(`That didn't work: ${error instanceof Error ? error.message : String(error)}`);

  const savePath = async () => {
    const location = typedPath.current.trim();
    if (!location) return setMessage("Application data location cannot be empty.");
    if (location === snapshot?.appDataDir || expandHome(location) === snapshot?.appDataDir) {
      return setMessage("That is where the data already is.");
    }
    if (!moveDataLocation) return setMessage("Moving the data isn't available here.");
    setBusy(true);
    setMessage("Moving the data…");
    try {
      await moveDataLocation(location);
      const next = await load();
      setPath(next.appDataDir);
      setMessage(`Application data moved to ${next.appDataDir}.`);
      onDataMoved();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const saveCity = async () => {
    const result = await api.saveLocation(typedCity.current);
    if (result.error) return setMessage(result.error);
    await load();
    onCityChanged();
    if (!result.saved) return setMessage("Forgot the saved city; follow the sun uses stand-in times.");
    const { name, sunrise, sunset } = result.saved;
    setMessage(`Saved ${name}${sunrise && sunset ? `: sunrise ${sunrise}, sunset ${sunset}` : ""}.`);
  };

  const applyTheme = async (name: ThemeName) => {
    const result = await api.saveTheme(name);
    if (result.error) return setMessage(result.error);
    onThemeChange(name);
    onCityChanged(); // "follow the sun" may have just been chosen, or left
    setMessage(`Color scheme: ${themes.THEME_CHOICES.find((c) => c.name === name)?.label ?? name}.`);
  };

  useKeyboard((key) => {
    if (busy) return;
    switch (actionFor("settings", key)) {
      case "back":
        onClose();
        break;
      case "next-field":
        setField((current) => FIELDS[(FIELDS.indexOf(current) + 1) % FIELDS.length]);
        break;
    }
  });

  const choices = themes.THEME_CHOICES;
  // A dot marks the scheme in use, which the cursor may have left.
  const options: SelectOption[] = choices.map((choice) => ({
    name: `${choice.name === theme ? "●" : " "} ${choice.label}`,
    description: "",
  }));
  const input = {
    backgroundColor: palette.background,
    textColor: palette.foreground,
    focusedBackgroundColor: palette.surface,
    focusedTextColor: palette.foreground,
  };

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" flexDirection="column" backgroundColor={palette.background}>
      <box height={1} paddingLeft={1}>
        <text fg={palette.accent}>Settings</text>
      </box>

      {snapshot === null ? (
        <box paddingLeft={1}>
          <text fg={palette.muted}>Loading…</text>
        </box>
      ) : (
        <>
          <Section title="Application data location" focused={field === "path"} palette={palette} height={3}>
            <input
              focused={field === "path" && !busy}
              value={path}
              onInput={(next) => {
                typedPath.current = next;
                setPath(next);
              }}
              onSubmit={() => void savePath().catch(fail)}
              {...input}
            />
          </Section>

          <Section title="Color scheme" focused={field === "theme"} palette={palette} height={choices.length + 2}>
            <select
              focused={field === "theme"}
              options={options}
              selectedIndex={Math.max(0, choices.findIndex((choice) => choice.name === theme))}
              showDescription={false}
              height="100%"
              backgroundColor={palette.background}
              textColor={palette.foreground}
              focusedBackgroundColor={palette.background}
              focusedTextColor={palette.foreground}
              selectedBackgroundColor={field === "theme" ? palette.selection : palette.surface}
              selectedTextColor={field === "theme" ? palette.selectionText : palette.foreground}
              onSelect={(index) => void applyTheme(choices[index].name).catch(fail)}
            />
          </Section>

          <Section title="City, for follow the sun" focused={field === "city"} palette={palette} height={4}>
            <input
              focused={field === "city"}
              value={city}
              placeholder="City, State or City, Country"
              onInput={(next) => {
                typedCity.current = next;
                setCity(next);
              }}
              onSubmit={() => void saveCity().catch(fail)}
              {...input}
            />
            <text fg={palette.muted}>
              {snapshot.sunTimes?.sunrise && snapshot.sunTimes?.sunset
                ? `Today: sunrise ${snapshot.sunTimes.sunrise}, sunset ${snapshot.sunTimes.sunset}`
                : "Without a city it uses 06:30 and 18:30."}
            </text>
          </Section>
        </>
      )}

      <box flexGrow={1} />
      <box height={1} paddingLeft={1}>
        <text fg={message ? palette.warning : palette.muted}>{message ?? footerFor("settings", width - 2)}</text>
      </box>
    </box>
  );
}
