import {
  clampCliSidebarColumns,
  clampEditorRatio,
  DEFAULT_CLI_SIDEBAR_COLUMNS,
  loadWebSettings,
  saveWebSettings,
} from "./backend";

/**
 * The two sizes a person can change in the terminal app and have remembered: how many columns the
 * tree takes, and how much of a pane the editor takes when it shows editor and preview together.
 * Stored in the CLI's own settings file (the apps keep separate ones); the sidebar in its own
 * field, in columns, and the share in `editorRatio`, which means the same in every app.
 */
export type Columns = { sidebarColumns: number; editorRatio: number };

export const SIDEBAR_STEP = 2;
export const RATIO_STEP = 0.1;

/** The least room left for the panes beside the tree, so a wide tree can't squeeze them out. */
export const MIN_PANE_AREA = 30;

export type Direction = -1 | 1;

export function resizeSidebar(columns: number, direction: Direction): number {
  return clampCliSidebarColumns(columns + direction * SIDEBAR_STEP);
}

/** Rounded to hundredths, so ten steps from 0.5 land on 0.8 and not 0.7999999. */
export function resizeEditorShare(ratio: number, direction: Direction): number {
  return clampEditorRatio(Math.round((ratio + direction * RATIO_STEP) * 100) / 100);
}

/** The sidebar as drawn: as wide as asked, unless the terminal is too narrow to leave the panes `MIN_PANE_AREA`. */
export function drawnSidebar(columns: number, terminalWidth: number): number {
  return Math.max(Math.min(columns, DEFAULT_CLI_SIDEBAR_COLUMNS), Math.min(columns, terminalWidth - MIN_PANE_AREA));
}

export function loadColumns(): Columns {
  const settings = loadWebSettings();
  return {
    sidebarColumns: settings.cliSidebarColumns ?? DEFAULT_CLI_SIDEBAR_COLUMNS,
    editorRatio: settings.editorRatio,
  };
}

export function saveColumns(columns: Columns): void {
  saveWebSettings({ ...loadWebSettings(), cliSidebarColumns: columns.sidebarColumns, editorRatio: columns.editorRatio });
}
