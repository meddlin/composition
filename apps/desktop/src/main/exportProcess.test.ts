import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExportJob, ExportOutcome } from "./exportJob";
import { runExport, workerPath, type ExportChild } from "./exportProcess";

const job: ExportJob = { sourcePath: "/library/a.pdf", targetPath: "/out/a.pdf", marks: [], flatten: false };

/** A stand-in for the utility process: it can spawn, answer, or exit, when the test says. */
function fakeChild() {
  const events = new EventEmitter();
  const child = {
    postMessage: vi.fn(),
    kill: vi.fn(() => true),
    once: (event: string, listener: (...args: unknown[]) => void) => events.once(event, listener),
  } as unknown as ExportChild & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> };
  return { child, events };
}

describe("runExport", () => {
  it("hands the job to the process once it has started, and answers with what it says, then ends it", async () => {
    const { child, events } = fakeChild();
    const done = runExport(() => child, job);
    expect(child.postMessage).not.toHaveBeenCalled();

    events.emit("spawn");
    expect(child.postMessage).toHaveBeenCalledWith(job);
    const outcome: ExportOutcome = { ok: true, written: 3, skipped: { ink: 0, offPage: 0 } };
    events.emit("message", outcome);

    expect(await done).toEqual(outcome);
    expect(child.kill).toHaveBeenCalled();
  });

  it("says the export stopped when the process ends without answering, such as when it runs out of memory", async () => {
    const { child, events } = fakeChild();
    const done = runExport(() => child, job);

    events.emit("spawn");
    events.emit("exit", 137);

    const outcome = await done;
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok === false && outcome.error).toMatch(/stopped before it finished \(code 137\).*memory/);
  });

  it("answers only once, whichever comes last", async () => {
    const { child, events } = fakeChild();
    const done = runExport(() => child, job);

    events.emit("spawn");
    events.emit("message", { ok: false, error: "no" });
    events.emit("exit", 0);

    expect(await done).toEqual({ ok: false, error: "no" });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("says so when the process cannot be started", async () => {
    const outcome = await runExport(() => {
      throw new Error("no such file");
    }, job);

    expect(outcome).toEqual({ ok: false, error: "The export could not start: no such file." });
  });
});

describe("workerPath", () => {
  const dir = path.join("/Applications/Composition.app/Contents/Resources/app.asar", "dist");

  it("is the script beside main.js when the app is not packed into an archive", () => {
    expect(workerPath("/work/apps/desktop/dist", () => false)).toBe(path.join("/work/apps/desktop/dist", "export-worker.js"));
  });

  it("is the unpacked copy beside the archive when the app is packaged, since a child process is started from a real file", () => {
    expect(workerPath(dir, () => true)).toBe(path.join("/Applications/Composition.app/Contents/Resources/app.asar.unpacked", "dist", "export-worker.js"));
  });

  it("is the archive's own path when no unpacked copy is there", () => {
    expect(workerPath(dir, () => false)).toBe(path.join(dir, "export-worker.js"));
  });
});
