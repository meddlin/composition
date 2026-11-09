import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SaveFileApi, SaveFileKind } from "../../../web/src/lib/composition/saveFileApi";

/**
 * The desktop-only SaveFileApi (see apps/web/src/lib/composition/saveFileApi.ts).
 *
 * The page hands over the bytes of a file it made and a suggested name; the operating system's save dialog is what chooses
 * where they go. The renderer never names a path, so a compromised page can't make the app write to a file of its choosing,
 * and a file is written only where the person says. Like attachments.ts and backup.ts, what the dialog returns is used as it
 * is, except that the file's extension is made to match what it is.
 */

/** What the dialog shows for each kind, and the extension it filters on. */
const FILTERS: Record<SaveFileKind, { name: string; extensions: string[] }> = {
  xlsx: { name: "Excel workbook", extensions: ["xlsx"] },
  csv: { name: "CSV", extensions: ["csv"] },
};

/** The name offered when the page's suggestion leaves nothing usable. */
const FALLBACK_NAME = "File";

/** The most the offered name may weigh, before its extension. */
const MAX_BASE_LENGTH = 100;

/** The native pieces this needs, as plain functions, so tests don't need Electron. */
export type SaveFileUi = {
  /** The save dialog, over the window that asked; `canceled` when it was dismissed. */
  showSaveDialog(options: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<{ canceled: boolean; filePath?: string }>;
  /** The folder the dialog opens in. */
  defaultFolder(): string;
};

/** The parts of `fs.promises` the write uses. */
export type SaveFileFs = Pick<typeof fs.promises, "writeFile" | "rename" | "rm">;

/**
 * What to offer in the dialog for the page's `suggested` name: only its last part (a path separator never survives, so `../x`
 * offers `x`), without characters a file name can't hold on some system, no leading dots or trailing dots and spaces, at most
 * {@link MAX_BASE_LENGTH} characters, and always ending in the extension for `kind`.
 */
export function offeredFileName(suggested: string, kind: SaveFileKind): string {
  const extension = `.${kind}`;
  const last = suggested.split(/[\\/]/).pop() ?? "";
  const withoutExtension = last.toLowerCase().endsWith(extension) ? last.slice(0, -extension.length) : last;
  const cleaned = withoutExtension.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "_").replace(/^[.\s]+|[.\s]+$/g, "");
  // By characters, not code units, so a long name never ends in half of an emoji.
  const base = Array.from(cleaned).slice(0, MAX_BASE_LENGTH).join("").replace(/[.\s]+$/g, "");
  return `${base === "" ? FALLBACK_NAME : base}${extension}`;
}

/** The place the person chose, with the extension for `kind` if the dialog (Linux's, for one) left it off. */
function withExtension(filePath: string, kind: SaveFileKind): string {
  const extension = `.${kind}`;
  return filePath.toLowerCase().endsWith(extension) ? filePath : `${filePath}${extension}`;
}

export function createSaveFileApi(ui: SaveFileUi, files: SaveFileFs = fs.promises): SaveFileApi {
  // A page can ask again before the first dialog is answered (a double click, or a page that means harm); one dialog is enough.
  let asking = false;

  return {
    async saveFile({ name, bytes, kind }) {
      if (asking) return { saved: false, error: "A save dialog is already open." };
      asking = true;
      try {
        const { canceled, filePath } = await ui.showSaveDialog({
          defaultPath: path.join(ui.defaultFolder(), offeredFileName(name, kind)),
          filters: [FILTERS[kind]],
        });
        if (canceled || !filePath) return { saved: false };
        return await writeAtomically(files, withExtension(filePath, kind), bytes);
      } catch (error) {
        return { saved: false, error: `Could not save the file: ${describe(error)}` };
      } finally {
        asking = false;
      }
    },
  };
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Writes beside `target` and renames over it, so a crash or a full disk can't leave half a file where the person chose. */
async function writeAtomically(files: SaveFileFs, target: string, bytes: Uint8Array): Promise<{ saved: boolean; error?: string }> {
  const temporary = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await files.writeFile(temporary, bytes);
    await files.rename(temporary, target);
    return { saved: true };
  } catch (error) {
    await files.rm(temporary, { force: true }).catch(() => {});
    return { saved: false, error: `Could not save the file: ${describe(error)}` };
  }
}
