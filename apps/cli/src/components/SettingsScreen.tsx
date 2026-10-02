import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import { describeCounts, expandHome, formatBytes, themes, type BackupResult, type SettingsSnapshot, type ThemeName } from "../backend";
import { actionFor, footerFor } from "../keymap";
import type { Palette } from "../theme";

type Field = "path" | "theme" | "city" | "backup" | "restore";
const FIELDS: Field[] = ["path", "theme", "city", "backup", "restore"];

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
  /** Saves every open note, so a backup holds the latest edits and a restore leaves nothing half-written behind. */
  flushNotes: () => Promise<void>;
  /** Called after a backup was restored: everything the workspace shows (notes, pins, open panes) is out of date. */
  onRestored: () => void;
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
 * Where the data lives, which color scheme to use, the city "follow the sun" uses, and backing up
 * and restoring everything. Tab moves between them; Enter saves or applies the one you are on.
 */
export function SettingsScreen({ api, palette, width, theme, onThemeChange, onCityChanged, moveDataLocation, onDataMoved, flushNotes, onRestored, onClose }: SettingsScreenProps) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [field, setField] = useState<Field>("path");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("");
  const [city, setCity] = useState("");
  const [backupDir, setBackupDir] = useState("");
  const [backupFile, setBackupFile] = useState("");
  // The backup file waiting for a "y": restoring replaces everything, so Enter only asks.
  const [confirming, setConfirming] = useState<string | null>(null);
  // The inputs' own submit argument is typed loosely; what was typed is tracked here instead.
  const typedPath = useRef("");
  const typedCity = useRef("");
  const typedBackupDir = useRef("");
  const typedBackupFile = useRef("");

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
      setBackupDir(first.backupDir);
      typedBackupDir.current = first.backupDir;
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

  const describe = (result: BackupResult) => (result.counts ? describeCounts(result.counts) : "everything");

  const createBackup = async () => {
    setBusy(true);
    setMessage("Backing up…");
    try {
      await flushNotes();
      const result = await api.createBackup(typedBackupDir.current);
      if (result.error) return setMessage(result.error);
      const size = result.bytes === undefined ? "" : ` (${formatBytes(result.bytes)})`;
      setMessage(`Backed up ${describe(result)} to ${result.file}${size}.`);
    } finally {
      setBusy(false);
    }
  };

  const askToRestore = () => {
    const file = typedBackupFile.current.trim();
    if (!file) return setMessage("Enter the path of a backup file.");
    setConfirming(file);
    setMessage(`Press y to replace EVERYTHING here with this backup, any other key to cancel. What is here now is saved first. (${file})`);
  };

  const restore = async (file: string) => {
    setConfirming(null);
    setBusy(true);
    setMessage("Restoring…");
    try {
      await flushNotes();
      const result = await api.restoreBackup(file);
      if (result.error) return setMessage(result.error);
      const next = await load();
      setPath(next.appDataDir);
      typedPath.current = next.appDataDir;
      setCity(next.city);
      typedCity.current = next.city;
      onThemeChange(next.theme);
      onCityChanged();
      onRestored();
      setMessage(`Restored ${describe(result)}.${result.safetyBackup ? ` What it replaced is saved in ${result.safetyBackup}.` : ""}`);
    } finally {
      setBusy(false);
    }
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
    if (confirming !== null) {
      if (actionFor("settings", key) === "confirm") void restore(confirming).catch(fail);
      else {
        setConfirming(null);
        setMessage("Restore cancelled.");
      }
      return;
    }
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

          <Section title="Create a backup, in this folder" focused={field === "backup"} palette={palette} height={3}>
            <input
              focused={field === "backup" && !busy}
              value={backupDir}
              onInput={(next) => {
                typedBackupDir.current = next;
                setBackupDir(next);
              }}
              onSubmit={() => void createBackup().catch(fail)}
              {...input}
            />
          </Section>

          <Section title="Restore from this backup file" focused={field === "restore"} palette={palette} height={3}>
            <input
              focused={field === "restore" && !busy && confirming === null}
              value={backupFile}
              placeholder="Path of a composition-backup-….tar.gz"
              onInput={(next) => {
                typedBackupFile.current = next;
                setBackupFile(next);
              }}
              onSubmit={askToRestore}
              {...input}
            />
          </Section>
        </>
      )}

      <box flexGrow={1} />
      <box height={message ? Math.min(3, Math.ceil(message.length / Math.max(1, width - 3))) : 1} paddingLeft={1}>
        <text fg={message ? palette.warning : palette.muted}>{message ?? footerFor("settings", width - 2)}</text>
      </box>
    </box>
  );
}
