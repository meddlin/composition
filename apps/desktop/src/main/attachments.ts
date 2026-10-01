import fs from "node:fs";
import type { AttachmentActionResult, AttachmentsApi } from "../../../web/src/lib/composition/attachmentsApi";
import type { service as Service } from "./backend";

/**
 * The desktop-only AttachmentsApi (see apps/web/src/lib/composition/attachmentsApi.ts).
 *
 * The operating system's dialogs are what choose files: the renderer asks to
 * "attach to note 7" or "save attachment 3", never names a path. So a
 * compromised page can't make the app copy `~/.ssh/id_rsa` into a note, or
 * overwrite a file of its choosing. What the dialogs return is handed straight
 * to the service, which owns the stored files.
 *
 * Deliberately not offered: opening an attachment with its default app. An
 * attached `.command` or `.app` would run, and notes (with their attachments)
 * can arrive from someone else's database. Showing the file in Finder, or saving
 * a copy, leaves that choice with the user.
 */

/** The native pieces this needs, as plain functions, so tests don't need Electron. */
export type AttachmentUi = {
  /** Paths the user picked, or none if they cancelled. */
  pickFiles(): Promise<string[]>;
  /** Where the user wants a copy saved, or null if they cancelled. */
  pickSavePath(defaultName: string): Promise<string | null>;
  reveal(path: string): void;
};

type AttachmentService = Pick<
  typeof Service,
  "listAttachments" | "addAttachmentFiles" | "findAttachmentFile" | "removeAttachment"
>;

const GONE = "That attachment's file is missing from the application data folder.";

export function createAttachmentsApi(service: AttachmentService, ui: AttachmentUi): AttachmentsApi {
  return {
    listAttachments: (noteId) => service.listAttachments(noteId),

    async addAttachments(noteId) {
      const paths = await ui.pickFiles();
      if (paths.length === 0) return { attachments: [] };
      return service.addAttachmentFiles(noteId, paths);
    },

    async revealAttachment(id) {
      const found = await service.findAttachmentFile(id);
      if (!found) return { error: GONE };
      ui.reveal(found.path);
      return {};
    },

    async saveAttachmentCopy(id): Promise<AttachmentActionResult> {
      const found = await service.findAttachmentFile(id);
      if (!found) return { error: GONE };
      const destination = await ui.pickSavePath(found.fileName);
      if (!destination) return { canceled: true };
      try {
        await fs.promises.copyFile(found.path, destination);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: `Could not save a copy: ${message}` };
      }
      return {};
    },

    removeAttachment: (id) => service.removeAttachment(id),
  };
}
