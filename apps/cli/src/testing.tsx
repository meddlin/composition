import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReactNode } from "react";
import { testRender } from "@opentui/react/test-utils";
import { vi } from "vitest";
import { defaultApi, type Api } from "./api";
import { App } from "./App";
import { closeDb, searchIndex, service } from "./backend";

/** Helpers for tests that render the real app over a real, temporary database. */

// React asks for act() wrappers that a terminal renderer has no use for.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

export type Rendered = Awaited<ReturnType<typeof testRender>>;

export type Sandbox = {
  home: string;
  /** Mounts the app over whatever is in the database now. */
  mount: (options?: { api?: Partial<Api>; width?: number; height?: number }) => Promise<Rendered>;
  dispose: () => Promise<void>;
};

/** A temp home with its own settings file, so no test ever touches real notes. */
export function createSandbox(): Sandbox {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-ui-"));
  const settings = path.join(home, "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ appDataDir: path.join(home, "data"), theme: "dark" }));
  vi.stubEnv("COMPOSITION_SETTINGS_PATH", settings);
  // Saving a note indexes it. Without this a test would try web's default Meilisearch port, and
  // write into a developer's real index if `pnpm meili` happened to be running.
  searchIndex.disableSearch("Search is off in tests.");
  const mounted: Rendered[] = [];

  return {
    home,
    async mount({ api = {}, width = 120, height = 30 } = {}) {
      const initial = await service.loadWorkspace();
      const rendered = await testRender(<App initial={initial} api={{ ...defaultApi, ...api }} />, { width, height });
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
