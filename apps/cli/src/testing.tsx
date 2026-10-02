import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReactNode } from "react";
import { testRender } from "@opentui/react/test-utils";
import { vi } from "vitest";
import { defaultApi, type Api } from "./api";
import { App } from "./App";
import { closeDb, service } from "./backend";
import { keepSearchOffline } from "./offlineSearch";

/** Helpers for tests that render the real app over a real, temporary database. */

// React asks for act() wrappers that a terminal renderer has no use for.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

export type Rendered = Awaited<ReturnType<typeof testRender>>;

export type Sandbox = {
  home: string;
  /** Mounts the app over whatever is in the database now. */
  mount: (options?: {
    api?: Partial<Api>;
    width?: number;
    height?: number;
    theme?: string;
    moveDataLocation?: (destination: string) => Promise<void>;
  }) => Promise<Rendered>;
  dispose: () => Promise<void>;
};

/** A temp home with its own settings file, so no test ever touches real notes. */
export function createSandbox(): Sandbox {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-ui-"));
  const settings = path.join(home, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ appDataDir: path.join(home, "data"), theme: "dark" }));
  vi.stubEnv("COMPOSITION_SETTINGS_PATH", settings);
  // Saving a note tries to index it, and web's search layer defaults to the Meilisearch a developer
  // may have running on 7700. This points it at nothing, so notes saved here can't reach that index;
  // dispose() undoes it.
  keepSearchOffline();
  const mounted: Rendered[] = [];

  return {
    home,
    async mount({ api = {}, width = 120, height = 30, theme, moveDataLocation } = {}) {
      const initial = await service.loadWorkspace();
      const rendered = await testRender(<App initial={initial} api={{ ...defaultApi, ...api }} theme={theme} moveDataLocation={moveDataLocation} />, { width, height });
      // testRender turns act() warnings on; the app's own timers update state outside act on purpose.
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
      mounted.push(rendered);
      await settle(rendered);
      return rendered;
    },
    async dispose() {
      for (const rendered of mounted) {
        try {
          rendered.renderer.destroy();
        } catch {
          // already destroyed by the app quitting
        }
      }
      closeDb();
      vi.unstubAllEnvs();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lets pending renders, timers and the Markdown worker catch up. */
export async function settle(rendered: Rendered, ms = 250): Promise<void> {
  await rendered.renderOnce();
  await sleep(ms);
  await rendered.renderOnce();
}

export const frame = (rendered: Rendered): string => rendered.captureCharFrame();

/** The background color of one screen cell, as #RRGGBB: proof of what the user would see. */
export function backgroundAt(rendered: Rendered, row: number, column: number): string {
  const { lines } = rendered.captureSpans() as unknown as {
    lines: { spans: { width: number; bg: { buffer: ArrayLike<number> } }[] }[];
  };
  let x = 0;
  for (const span of lines[row].spans) {
    if (column < x + span.width) {
      const [r, g, b] = [0, 1, 2].map((i) => span.bg.buffer[i]);
      const scale = r > 1 || g > 1 || b > 1 ? 1 : 255; // 0-255, or 0-1 floats
      return `#${[r, g, b].map((c) => Math.round(c * scale).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
    }
    x += span.width;
  }
  throw new Error(`no cell at row ${row}, column ${column}`);
}

export async function press(rendered: Rendered, key: string, modifiers: { ctrl?: boolean; meta?: boolean } = {}, ms = 150) {
  rendered.mockInput.pressKey(key as never, modifiers as never);
  await settle(rendered, ms);
}

export async function pressEscape(rendered: Rendered, ms = 150) {
  rendered.mockInput.pressEscape();
  await settle(rendered, ms);
}

export async function type(rendered: Rendered, text: string, ms = 150) {
  await rendered.mockInput.typeText(text);
  await settle(rendered, ms);
}

export { sleep };
export type { ReactNode };
