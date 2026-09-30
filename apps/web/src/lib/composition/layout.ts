/**
 * Column sizes the user can drag in the notes workspace. The sidebar is a pixel
 * width; the editor's share of the editor+preview area is a 0-1 ratio so it
 * keeps its proportion when the window is resized.
 */

export const DEFAULT_SIDEBAR_WIDTH = 256;
export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 480;

export const DEFAULT_EDITOR_RATIO = 0.5;
export const MIN_EDITOR_RATIO = 0.2;
export const MAX_EDITOR_RATIO = 0.8;

export type Layout = {
  sidebarWidth: number;
  editorRatio: number;
};

export const DEFAULT_LAYOUT: Layout = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  editorRatio: DEFAULT_EDITOR_RATIO,
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function clampSidebarWidth(value: unknown): number {
  return clamp(value, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

export function clampEditorRatio(value: unknown): number {
  return clamp(value, DEFAULT_EDITOR_RATIO, MIN_EDITOR_RATIO, MAX_EDITOR_RATIO);
}

/**
 * The editor ratio after dragging the editor/preview divider `dxPx` from where
 * the drag started. Unchanged when the container has no measurable width.
 */
export function dragRatio(startRatio: number, dxPx: number, containerWidthPx: number): number {
  if (!(containerWidthPx > 0)) return startRatio;
  return clampEditorRatio(startRatio + dxPx / containerWidthPx);
}
