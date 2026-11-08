import type { PdfAnnotation } from "../../../web/src/lib/composition/documentsApi";

/**
 * What the main process hands the export worker (apps/desktop/src/worker/exportWorker.ts), and what it gets back. Paths only ever
 * come from the app itself: the source from the library, the target from the operating system's save dialog.
 */
export type ExportJob = { sourcePath: string; targetPath: string; marks: PdfAnnotation[]; flatten: boolean };

export type ExportOutcome =
  | { ok: true; written: number; skipped: { ink: number; offPage: number } }
  | { ok: false; error: string };
