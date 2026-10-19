import { listAttachments as listAttachmentsAction, removeAttachment as removeAttachmentAction } from "./actions";
import type { AddAttachmentsResult, AttachmentsApi } from "./attachmentsApi";
import { formatBytes, MAX_ATTACHMENT_BYTES } from "./attachmentNames";
import { UPLOAD_HEADER } from "./uploadGuard";

/**
 * What the attachments UI imports to reach the backend. In the web build the
 * list and the removal are Server Actions, and the bytes travel over `fetch`:
 * an upload streams to `/api/notes/<id>/attachments`, a download is a link to
 * `/api/attachments/<id>`. The desktop build resolves `attachmentsClient.desktop.ts`
 * instead (next.config.ts), which calls Electron's main process, where native
 * dialogs choose the files.
 */

/** How the two builds differ for the one UI they share. */
export const attachmentCapabilities = {
  /** A browser can't reveal a file in the user's file manager; the stored copy is on the server's disk. */
  canReveal: false,
  /** What the "get a copy" button is called: the browser downloads where the desktop app asks for a place to save. */
  saveCopyTitle: "Download",
  saveCopyLabel: (fileName: string) => `Download ${fileName}`,
};

/** Opens the browser's file picker. Resolves with the chosen files, or none if it was dismissed. */
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.addEventListener("change", () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    // Older browsers send no "cancel": the window getting focus back means the dialog closed, and a
    // chosen file's "change" has fired by then (the first resolve wins).
    window.addEventListener("focus", () => setTimeout(() => resolve([]), 1000), { once: true });
    input.click();
  });
}

async function upload(noteId: number, file: File): Promise<AddAttachmentsResult> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { attachments: [], error: `${file.name}: files can be at most ${formatBytes(MAX_ATTACHMENT_BYTES)}.` };
  }
  try {
    const response = await fetch(`/api/notes/${noteId}/attachments?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { [UPLOAD_HEADER]: "1" },
      body: file,
    });
    return (await response.json()) as AddAttachmentsResult;
  } catch {
    return { attachments: [], error: `${file.name}: could not be attached.` };
  }
}

export const listAttachments: AttachmentsApi["listAttachments"] = listAttachmentsAction;
export const removeAttachment: AttachmentsApi["removeAttachment"] = removeAttachmentAction;

/** Must be called straight from the click that wants it: browsers only open the picker for a user gesture. */
export const addAttachments: AttachmentsApi["addAttachments"] = async (noteId) => {
  const files = await pickFiles();
  const attachments: AddAttachmentsResult["attachments"] = [];
  const errors: string[] = [];
  // One at a time: each is a stream to disk, and a failure names its own file.
  for (const file of files) {
    const result = await upload(noteId, file);
    attachments.push(...result.attachments);
    if (result.error) errors.push(result.error);
  }
  return { attachments, ...(errors.length > 0 && { error: errors.join(" ") }) };
};

export const revealAttachment: AttachmentsApi["revealAttachment"] = async () => ({
  error: "A browser can't show a file in the file manager. Download it instead.",
});

export const saveAttachmentCopy: AttachmentsApi["saveAttachmentCopy"] = async (id) => {
  const url = `/api/attachments/${id}`;
  // A download link can't report a missing file (the browser would save the 404 page), so ask first.
  try {
    const probe = await fetch(url, { method: "HEAD" });
    if (!probe.ok) return { error: "That attachment's file is missing from the application data folder." };
  } catch {
    return { error: "Could not download the attachment." };
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.click();
  return {};
};

export type {
  AddAttachmentsResult,
  Attachment,
  AttachmentActionResult,
} from "./attachmentsApi";
