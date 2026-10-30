/**
 * Built-in plugins: features that are switched on or off in Settings > Plugins. A plugin that is off is not offered
 * and does not run, but nothing it stored is touched, so turning it back on brings everything back.
 *
 * The registry is fixed at build time. Loading plugins from outside the app is future work (it needs a sandbox, an API
 * surface and signing; see docs/panel-system-plan.md).
 */

export const PLUGINS = [
  {
    id: "todo",
    name: "To-do",
    description:
      "A to-do list in a panel of its own, with sub-items, and a background of its own under Settings > Styling. Turning it off hides the panel and its settings; your items are kept.",
    host: "desktop",
  },
  {
    id: "reading-list",
    name: "Reading List",
    description:
      "A list of article links with the page of the one you pick shown beside it, so a reading list can be read without leaving Composition. Off until you turn it on, because it lets the app load web pages. Turning it off hides the panel; your links are kept.",
    host: "desktop",
    defaultEnabled: false,
  },
] as const satisfies readonly {
  id: string;
  name: string;
  description: string;
  host: "desktop" | "any";
  /** Whether the plugin is on until the user chooses. Left out means on: a plugin that only adds UI changes nothing for anyone who ignores it. */
  defaultEnabled?: boolean;
}[];

export type PluginId = (typeof PLUGINS)[number]["id"];

/** Which plugins are on. Every plugin has an entry, so a reader never has to guess a default. */
export type PluginSettings = Record<PluginId, boolean>;

/**
 * Whether a plugin is on until the user chooses. Most are, so the app behaves as it did before the plugin existed; one that
 * brings in a new capability (the Reading List loads web pages) says `defaultEnabled: false` and waits to be switched on.
 */
const defaultFor = (plugin: (typeof PLUGINS)[number]): boolean => !("defaultEnabled" in plugin) || plugin.defaultEnabled;

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = Object.fromEntries(PLUGINS.map((plugin) => [plugin.id, defaultFor(plugin)])) as PluginSettings;

/** Whether a plugin runs in the app this is: the web app and the desktop app share Settings, but not every plugin. */
export function pluginRunsIn(plugin: { host: "desktop" | "any" }, app: "web" | "desktop"): boolean {
  return plugin.host === "any" || plugin.host === app;
}

export function isPluginId(value: unknown): value is PluginId {
  return PLUGINS.some(({ id }) => id === value);
}

/** Reads saved settings, falling back to the plugin's default when it is missing or not a boolean; unknown plugins are dropped. */
export function parsePluginSettings(value: unknown): PluginSettings {
  const data = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(PLUGINS.map((plugin) => [plugin.id, typeof data[plugin.id] === "boolean" ? data[plugin.id] : defaultFor(plugin)])) as PluginSettings;
}

/** Checks settings that came from outside (a form, a bridge call): every plugin must be there, as a boolean, and no other. */
export function validatePluginSettings(value: unknown): { settings?: PluginSettings; error?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "Plugin settings must be an object." };
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!isPluginId(key)) return { error: `Unknown plugin: ${key}.` };
  for (const { id, name } of PLUGINS) if (typeof data[id] !== "boolean") return { error: `The ${name} plugin must be on or off.` };
  return { settings: parsePluginSettings(data) };
}
