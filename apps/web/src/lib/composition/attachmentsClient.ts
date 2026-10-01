import type { AttachmentsApi } from "./attachmentsApi";

/**
 * What the attachments UI imports to reach the backend. Attachments are desktop
 * only (attachmentsApi.ts): there is no Server Action to call, and the web build
 * never renders the UI that imports this (see AttachmentsSlot.tsx). This stub
 * exists so that UI still type-checks and tests there, and fails loudly if it
 * were ever reached. The desktop build resolves `attachmentsClient.desktop.ts`
 * instead (next.config.ts).
 */
const unavailable = async (): Promise<never> => {
  throw new Error("Attachments are only available in the desktop app.");
};

export const listAttachments: AttachmentsApi["listAttachments"] = unavailable;
export const addAttachments: AttachmentsApi["addAttachments"] = unavailable;
export const revealAttachment: AttachmentsApi["revealAttachment"] = unavailable;
export const saveAttachmentCopy: AttachmentsApi["saveAttachmentCopy"] = unavailable;
export const removeAttachment: AttachmentsApi["removeAttachment"] = unavailable;

export type {
  AddAttachmentsResult,
  Attachment,
  AttachmentActionResult,
} from "./attachmentsApi";
