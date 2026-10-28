import fs from "node:fs";
import path from "node:path";
import type { Bounds } from "./popoutWindows";

/** The part of a display a window may use (its work area: not under the menu bar or the Dock). */
export type DisplayArea = { x: number; y: number; width: number; height: number };

export type WindowState = {
  /** Where the window was last, moved onto a display that is there now; undefined if it was never seen. */
  boundsFor(windowId: string): Bounds | undefined;
  remember(windowId: string, bounds: Bounds): void;
  forget(windowId: string): void;
};

function isBounds(value: unknown): value is Bounds {
  const { x, y, width, height } = (value ?? {}) as Record<string, unknown>;
  return (
    [x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (width as number) > 0 &&
    (height as number) > 0
  );
}

function overlap(a: Bounds, b: DisplayArea): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The bounds moved wholly onto one display: the one the window overlaps most, or the first when it overlaps none (the
 * display it was on is gone), shrunk if it is larger than that display.
 */
function onADisplay(bounds: Bounds, displays: readonly DisplayArea[]): Bounds {
  if (displays.length === 0) return bounds;

  const display = displays.reduce(
    (best, next) => (overlap(bounds, next) > overlap(bounds, best) ? next : best),
    displays[0],
  );
  const width = Math.min(bounds.width, display.width);
  const height = Math.min(bounds.height, display.height);
  return {
    x: Math.max(display.x, Math.min(bounds.x, display.x + display.width - width)),
    y: Math.max(display.y, Math.min(bounds.y, display.y + display.height - height)),
    width,
    height,
  };
}

/**
 * Where pop-out windows were, kept in a file of the main process's own (`window-state.json`): only the main
 * process sees windows move, and the renderer's settings file has its own writer. A file that cannot be read or written
 * costs only the remembered places.
 */
export function createWindowState(options: { file: string; displays: () => readonly DisplayArea[] }): WindowState {
  const { file, displays } = options;

  const known = new Map<string, Bounds>();
  try {
    const { windows } = JSON.parse(fs.readFileSync(file, "utf-8")) as { windows?: unknown };
    if (typeof windows === "object" && windows !== null && !Array.isArray(windows)) {
      for (const [id, bounds] of Object.entries(windows)) if (isBounds(bounds)) known.set(id, bounds);
    }
  } catch {
    // No file yet, or one that is damaged: nothing is remembered.
  }

  function write(): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ windows: Object.fromEntries(known) }, null, 2));
      fs.renameSync(temporary, file);
    } catch {
      // Not remembered next time.
    }
  }

  return {
    boundsFor(windowId) {
      const bounds = known.get(windowId);
      return bounds && onADisplay(bounds, displays());
    },
    remember(windowId, bounds) {
      known.set(windowId, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
      write();
    },
    forget(windowId) {
      if (known.delete(windowId)) write();
    },
  };
}
