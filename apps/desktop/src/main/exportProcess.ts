import fs from "node:fs";
import path from "node:path";
import type { ExportJob, ExportOutcome } from "./exportJob";

/**
 * Runs an export in its own process and says how it went (docs/pdf-markup-plan.md, "Export annotated PDF"). The process is
 * started for each export and ended when it answers, so nothing stays in memory between exports. It is given by `fork`, which
 * is Electron's `utilityProcess.fork` in the app and a stand-in in tests.
 */
export type ExportChild = {
  postMessage(message: unknown): void;
  kill(): boolean;
  once(event: "spawn", listener: () => void): unknown;
  once(event: "message", listener: (message: unknown) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
};

export function runExport(fork: () => ExportChild, job: ExportJob): Promise<ExportOutcome> {
  return new Promise((resolve) => {
    let child: ExportChild;
    try {
      child = fork();
    } catch (error) {
      resolve({ ok: false, error: `The export could not start: ${error instanceof Error ? error.message : "an unknown error"}.` });
      return;
    }
    let settled = false;
    const finish = (outcome: ExportOutcome) => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve(outcome);
    };
    child.once("message", (message) => finish(message as ExportOutcome));
    // A process that ends without answering ran out of memory, or was stopped from outside.
    child.once("exit", (code) => finish({ ok: false, error: `The export stopped before it finished (code ${code}), perhaps for lack of memory. Try again with fewer apps open.` }));
    child.once("spawn", () => child.postMessage(job));
  });
}

/**
 * Where the worker's script is. Packaged, the app's files are in an archive (app.asar) and the worker is unpacked beside it
 * (`asarUnpack` in electron-builder.yml), since a child process is started from a real file.
 */
export function workerPath(directory: string, exists: (file: string) => boolean = fs.existsSync): string {
  const file = path.join(directory, "export-worker.js");
  const unpacked = file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return unpacked !== file && exists(unpacked) ? unpacked : file;
}
