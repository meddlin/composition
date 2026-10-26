/**
 * How the home page looks and when it opens, set in Settings > Home page.
 *
 * - `layout`: "rail" keeps the notes in a wide column with the notebooks in a slim column beside
 *   them; "strip" lists the notebooks as a row of chips above everything else.
 * - `sections`: which of the three sections show, and in what order. In the rail layout the
 *   notebooks always sit in the rail, so the order only applies to the other two.
 * - `recentCount`: how many notes "Recently updated" lists.
 * - `density`: how much each note card shows.
 * - `startup`: what the app opens to.
 * - `pinnedNotebooks`: notebooks pinned to the top of the home page. They live here, not in the
 *   favorites list, which the terminal app reads too and knows only notes and groups in.
 * - `notebookColors`: the color chosen for a notebook, by id; a notebook without one is colored by its place in the list.
 * - `recentSort`, `recentNotebook`: how "Recently updated" orders its notes, and the one notebook it is limited to.
 * - `header`: the heading at the top of the page.
 */

export const HOME_LAYOUTS = ["rail", "strip"] as const;
export type HomeLayout = (typeof HOME_LAYOUTS)[number];

export const HOME_SECTION_IDS = ["notebooks", "pinned", "recent"] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export type HomeSection = { id: HomeSectionId; visible: boolean };

export const RECENT_COUNTS = [6, 12, 24] as const;

/** "standard": title, excerpt and details. "compact": title and details. "list": one line each. */
export const HOME_DENSITIES = ["standard", "compact", "list"] as const;
export type HomeDensity = (typeof HOME_DENSITIES)[number];

/** "note": the app opens on a note, as it always has. "home": it opens on the home page. */
export const HOME_STARTUPS = ["note", "home"] as const;
export type HomeStartup = (typeof HOME_STARTUPS)[number];

export const HOME_COLORS = ["brand", "highlight", "success", "warning", "error"] as const;
export type HomeColor = (typeof HOME_COLORS)[number];

/** "edited": by the last change to the note. "opened": by the last time it was opened on this computer. */
export const RECENT_SORTS = ["edited", "opened"] as const;
export type RecentSort = (typeof RECENT_SORTS)[number];

export const HEADER_TITLE_MAX = 80;
export const DEFAULT_HEADER_TITLE = "Welcome back";

export type HomeHeader = {
  show: boolean;
  /** What the heading says; empty means the default, "Welcome back". */
  title: string;
};

export type HomeSettings = {
  layout: HomeLayout;
  sections: HomeSection[];
  recentCount: number;
  density: HomeDensity;
  startup: HomeStartup;
  pinnedNotebooks: number[];
  notebookColors: Record<string, HomeColor>;
  recentSort: RecentSort;
  /** The one notebook "Recently updated" is limited to; null for all of them. */
  recentNotebook: number | null;
  header: HomeHeader;
};

export const DEFAULT_HOME_SECTIONS: HomeSection[] = HOME_SECTION_IDS.map((id) => ({ id, visible: true }));

export const DEFAULT_HOME_SETTINGS: HomeSettings = {
  layout: "rail",
  sections: DEFAULT_HOME_SECTIONS,
  recentCount: 12,
  density: "standard",
  startup: "note",
  pinnedNotebooks: [],
  notebookColors: {},
  recentSort: "edited",
  recentNotebook: null,
  header: { show: true, title: "" },
};

const oneOf =
  <T extends string | number>(choices: readonly T[]) =>
  (value: unknown): value is T =>
    choices.includes(value as T);

export const isHomeLayout = oneOf(HOME_LAYOUTS);
export const isHomeSectionId = oneOf(HOME_SECTION_IDS);
export const isRecentCount = oneOf(RECENT_COUNTS);
export const isHomeDensity = oneOf(HOME_DENSITIES);
export const isHomeStartup = oneOf(HOME_STARTUPS);
export const isHomeColor = oneOf(HOME_COLORS);
export const isRecentSort = oneOf(RECENT_SORTS);

const isNotebookId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** Whether the notebook is pinned. */
export function isNotebookPinned(settings: HomeSettings, id: number): boolean {
  return settings.pinnedNotebooks.includes(id);
}

/** Pins the notebook at the end of the pinned ones, or unpins it if it was already pinned. */
export function toggleNotebookPin(settings: HomeSettings, id: number): HomeSettings {
  const pinnedNotebooks = isNotebookPinned(settings, id)
    ? settings.pinnedNotebooks.filter((n) => n !== id)
    : [...settings.pinnedNotebooks, id];
  return { ...settings, pinnedNotebooks };
}

function parsePinnedNotebooks(value: unknown): number[] {
  const ids: number[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    if (isNotebookId(entry) && !ids.includes(entry)) ids.push(entry);
  }
  return ids;
}

function parseNotebookColors(value: unknown): Record<string, HomeColor> {
  const colors: Record<string, HomeColor> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return colors;
  for (const [key, color] of Object.entries(value)) {
    if (/^[1-9]\d*$/.test(key) && isHomeColor(color)) colors[key] = color;
  }
  return colors;
}

function parseHeader(value: unknown): HomeHeader {
  const { show, title } = (value ?? {}) as Partial<Record<keyof HomeHeader, unknown>>;
  return {
    show: typeof show === "boolean" ? show : true,
    title: typeof title === "string" ? title.trim().slice(0, HEADER_TITLE_MAX) : "",
  };
}

/**
 * Whatever came off disk, reduced to each section exactly once: the entries that make sense keep
 * their order, and any section that was left out comes back, shown, after them.
 */
function parseSections(value: unknown): HomeSection[] {
  const sections: HomeSection[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const { id, visible } = (entry ?? {}) as Partial<Record<keyof HomeSection, unknown>>;
    if (!isHomeSectionId(id) || sections.some((s) => s.id === id)) continue;
    sections.push({ id, visible: typeof visible === "boolean" ? visible : true });
  }
  for (const id of HOME_SECTION_IDS) {
    if (!sections.some((s) => s.id === id)) sections.push({ id, visible: true });
  }
  return sections;
}

/** Reads settings from already-parsed JSON, falling back to the default for anything missing or invalid. */
export function parseHomeSettings(data: unknown): HomeSettings {
  const value = (data ?? {}) as Record<string, unknown>;
  const defaults = DEFAULT_HOME_SETTINGS;
  return {
    layout: isHomeLayout(value.layout) ? value.layout : defaults.layout,
    sections: parseSections(value.sections),
    recentCount: isRecentCount(value.recentCount) ? value.recentCount : defaults.recentCount,
    density: isHomeDensity(value.density) ? value.density : defaults.density,
    startup: isHomeStartup(value.startup) ? value.startup : defaults.startup,
    pinnedNotebooks: parsePinnedNotebooks(value.pinnedNotebooks),
    notebookColors: parseNotebookColors(value.notebookColors),
    recentSort: isRecentSort(value.recentSort) ? value.recentSort : defaults.recentSort,
    recentNotebook: isNotebookId(value.recentNotebook) ? value.recentNotebook : null,
    header: parseHeader(value.header),
  };
}

function validSections(value: unknown): value is HomeSection[] {
  if (!Array.isArray(value) || value.length !== HOME_SECTION_IDS.length) return false;
  const seen = new Set<unknown>();
  for (const entry of value) {
    const { id, visible } = (entry ?? {}) as Partial<Record<keyof HomeSection, unknown>>;
    if (!isHomeSectionId(id) || typeof visible !== "boolean" || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** The settings to save, or why they can't be. */
export function validateHomeSettings(data: unknown): { settings?: HomeSettings; error?: string } {
  const value = (data ?? {}) as Record<string, unknown>;
  if (!isHomeLayout(value.layout)) return { error: "Unknown home page layout." };
  if (!validSections(value.sections)) return { error: "The home page sections must each be listed once." };
  if (!isRecentCount(value.recentCount)) return { error: `Recent notes must be ${RECENT_COUNTS.join(", ")}.` };
  if (!isHomeDensity(value.density)) return { error: "Unknown card size." };
  if (!isHomeStartup(value.startup)) return { error: "Unknown start-up page." };
  if (!isRecentSort(value.recentSort)) return { error: "Unknown order for recent notes." };
  if (value.recentNotebook !== null && !isNotebookId(value.recentNotebook)) return { error: "Unknown notebook." };
  const pinned = value.pinnedNotebooks;
  if (!Array.isArray(pinned) || !pinned.every(isNotebookId) || new Set(pinned).size !== pinned.length) {
    return { error: "Pinned notebooks must be notebooks, each listed once." };
  }
  const colors = value.notebookColors;
  if (typeof colors !== "object" || colors === null || Array.isArray(colors)) return { error: "Unknown notebook colors." };
  const notebookColors: Record<string, HomeColor> = {};
  for (const [key, color] of Object.entries(colors)) {
    if (!/^[1-9]\d*$/.test(key) || !isHomeColor(color)) return { error: "Unknown notebook color." };
    notebookColors[key] = color;
  }
  const header = (value.header ?? {}) as Partial<Record<keyof HomeHeader, unknown>>;
  if (typeof header.show !== "boolean" || typeof header.title !== "string") return { error: "Unknown heading." };
  const title = header.title.trim();
  if (title.length > HEADER_TITLE_MAX) return { error: `The heading can be at most ${HEADER_TITLE_MAX} characters.` };
  return {
    settings: {
      layout: value.layout,
      sections: value.sections.map(({ id, visible }) => ({ id, visible })),
      recentCount: value.recentCount,
      density: value.density,
      startup: value.startup,
      pinnedNotebooks: [...pinned],
      notebookColors,
      recentSort: value.recentSort,
      recentNotebook: value.recentNotebook,
      header: { show: header.show, title },
    },
  };
}
