import type { AttachmentsApi } from "./attachmentsApi";
import type {} from "./desktopBridge";

/**
 * Desktop build's replacement for `attachmentsClient.ts` (see next.config.ts):
 * the same functions, carried over Electron IPC by the preload script's
 * `window.composition`.
 */
function bridge(): AttachmentsApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error(
      "The Composition desktop bridge is unavailable. This build only runs inside the desktop app.",
    );
  }
  return api;
}

export const listAttachments: AttachmentsApi["listAttachments"] = (noteId) =>
  bridge().listAttachments(noteId);
export const addAttachments: AttachmentsApi["addAttachments"] = (noteId) =>
  bridge().addAttachments(noteId);
export const revealAttachment: AttachmentsApi["revealAttachment"] = (id) =>
  bridge().revealAttachment(id);
export const saveAttachmentCopy: AttachmentsApi["saveAttachmentCopy"] = (id) =>
  bridge().saveAttachmentCopy(id);
export const removeAttachment: AttachmentsApi["removeAttachment"] = (id) =>
  bridge().removeAttachment(id);

export type {
  AddAttachmentsResult,
  Attachment,
  AttachmentActionResult,
} from "./attachmentsApi";
