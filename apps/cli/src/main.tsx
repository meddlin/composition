import { createCliRenderer, destroyTreeSitterClient } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { loadWebSettings, service } from "./backend";
import { startRuntime } from "./runtime";

const runtime = await startRuntime();
const workspace = await service.loadWorkspace();

// Set if something unexpected goes wrong, so it is printed once the terminal is back to normal.
let failure: unknown;

const renderer = await createCliRenderer({
  // ctrl+c is handled by the app (see App.tsx), which saves open notes before leaving.
  exitOnCtrlC: false,
  onDestroy: () => {
    // Stop Meilisearch and close the database before leaving.
    void runtime.stop().finally(() => {
      // OpenTUI parses Markdown on a worker thread that keeps Node alive after the
      // UI is gone, so ending it explicitly is what lets the process exit.
      void destroyTreeSitterClient().finally(() => {
        if (failure !== undefined) {
          console.error(failure instanceof Error ? failure.stack : failure);
          process.exit(1);
        }
        process.exit(0);
      });
    });
  },
});

// A crash must not leave the terminal in raw mode: give it back first, then report.
const fail = (error: unknown) => {
  failure ??= error;
  renderer.destroy();
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
createRoot(renderer).render(
  <App initial={workspace} theme={loadWebSettings().theme} moveDataLocation={runtime.moveDataLocation} />,
);
