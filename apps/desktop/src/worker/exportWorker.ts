import fs from "node:fs/promises";
import { exportAnnotatedPdf, ExportRefused } from "../../../web/src/lib/composition/pdfExport";
import type { ExportJob, ExportOutcome } from "../main/exportJob";
// Noto Sans (Latin, Greek, Cyrillic) and Noto Sans Math, both SIL OFL 1.1: what a text note is written in (see pdfExport.ts).
import notoSans from "../../../web/node_modules/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf";
import notoSansMath from "../../../web/node_modules/@expo-google-fonts/noto-sans-math/400Regular/NotoSansMath_400Regular.ttf";

/**
 * The export, in a utility process of its own (docs/pdf-markup-plan.md, "Export annotated PDF"): a full rewrite of a PDF takes
 * seconds on a big file and holds two to four times its size in memory, which the main process, and with it every window,
 * should not. It takes one job at a time from the main process, writes the copy beside its final name and renames it into
 * place so that a failure never leaves half a PDF where the user chose, and answers with what came of it.
 */
export async function runExport(job: ExportJob): Promise<ExportOutcome> {
  const partial = `${job.targetPath}.part`;
  try {
    const source = new Uint8Array(await fs.readFile(job.sourcePath));
    const result = await exportAnnotatedPdf(source, job.marks, { flatten: job.flatten, fonts: { text: notoSans, math: notoSansMath }, password: job.password });
    await fs.writeFile(partial, result.bytes);
    await fs.rename(partial, job.targetPath);
    return { ok: true, written: result.written, skipped: result.skipped, passwordProtected: result.passwordProtected };
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => {});
    if (error instanceof ExportRefused) return { ok: false, error: error.message };
    return { ok: false, error: `The export failed: ${error instanceof Error ? error.message : "an unknown error"}.` };
  }
}

// A utility process has a parent port to the process that forked it; a test imports `runExport` without one.
process.parentPort?.on("message", (event) => {
  void runExport(event.data as ExportJob).then((outcome) => process.parentPort.postMessage(outcome));
});
