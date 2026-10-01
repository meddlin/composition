/**
 * The contract for files attached to a note. Unlike `CompositionApi` (api.ts),
 * which both builds implement, this one is **desktop only**: the web app has no
 * Server Actions for it, so nothing in a web deployment can add, read or remove
 * an attachment. Types only here, apart from ATTACHMENT_METHODS, so this file is
 * safe to import anywhere (renderer, preload, main).
 *
 * Files are chosen and saved through the operating system's own dialogs, which
 * only the Electron main process can open. The renderer never supplies a path,
 * so a compromised page can't point the app at an arbitrary file on disk.
 */

/** One file attached to a note. The bytes live on disk (attachments.ts); this is the row that describes them. */
export type Attachment = {
  id: number;
  noteId: number;
  /** The name the file had when it was attached; what the user sees. */
  fileName: string;
  /** Size in bytes. */
  size: number;
  createdAt: string;
};

/**
 * Cancelling the picker is not an error: `attachments` is empty and `error` is
 * absent. When some files were attached and others refused, both are set.
 */
export type AddAttachmentsResult = { attachments: Attachment[]; error?: string };

/** `canceled` is set when the user dismissed a dialog; it is not a failure. */
export type AttachmentActionResult = { error?: string; canceled?: boolean };

export interface AttachmentsApi {
  listAttachments(noteId: number): Promise<Attachment[]>;
  /** Opens the native file picker and attaches whatever the user chooses to the note. */
  addAttachments(noteId: number): Promise<AddAttachmentsResult>;
  /** Shows the stored file in Finder. */
  revealAttachment(id: number): Promise<AttachmentActionResult>;
  /** Asks where to save, then writes a copy of the attachment there. */
  saveAttachmentCopy(id: number): Promise<AttachmentActionResult>;
  /** Detaches the file from its note and deletes the stored copy. */
  removeAttachment(id: number): Promise<AttachmentActionResult>;
}

/** Every method of AttachmentsApi, as data; the check below fails to compile if one is missing (see API_METHODS in api.ts). */
export const ATTACHMENT_METHODS = [
  "listAttachments",
  "addAttachments",
  "revealAttachment",
  "saveAttachmentCopy",
  "removeAttachment",
] as const satisfies readonly (keyof AttachmentsApi)[];

export type AttachmentMethod = (typeof ATTACHMENT_METHODS)[number];

type MissingFromAttachmentMethods = Exclude<keyof AttachmentsApi, AttachmentMethod>;
const _everyMethodListed: [MissingFromAttachmentMethods] extends [never] ? true : never = true;
void _everyMethodListed;
