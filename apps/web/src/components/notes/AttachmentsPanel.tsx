"use client";

import { DownloadIcon, FolderOpenIcon, PaperclipIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes } from "@/lib/composition/attachmentNames";
import {
  addAttachments,
  listAttachments,
  removeAttachment,
  revealAttachment,
  saveAttachmentCopy,
  type Attachment,
  type AttachmentActionResult,
} from "@/lib/composition/attachmentsClient";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : DATE_FORMAT.format(date);
}

/**
 * The files attached to one note, listed in a table below its editor, with a
 * button to attach more. Desktop only: the web build never imports this (see
 * AttachmentsSlot.tsx). With nothing attached there is no table, only the button.
 *
 * Files are picked and saved in the operating system's own dialogs, opened by
 * the main process; this component never handles a path or the file's bytes.
 *
 * Loads once per mount, so the parent keys it by note: switching a pane to
 * another note remounts it with that note's files.
 */
export function AttachmentsPanel({ noteId }: { noteId: number }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Removing deletes the stored file for good, so it takes a second click.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const headingId = useId();

  useEffect(() => {
    let current = true;
    listAttachments(noteId).then(
      (list) => current && setAttachments(list),
      () => current && setError("Could not load this note's attachments."),
    );
    return () => {
      current = false;
    };
  }, [noteId]);

  const attach = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await addAttachments(noteId);
      if (result.attachments.length > 0) {
        setAttachments((existing) => [...existing, ...result.attachments]);
      }
      if (result.error) setError(result.error);
    } catch {
      setError("Could not attach files.");
    } finally {
      setBusy(false);
    }
  }, [noteId]);

  const act = useCallback(async (run: () => Promise<AttachmentActionResult>, failure: string) => {
    setError(null);
    try {
      const result = await run();
      if (result.error) setError(result.error);
      return !result.error && !result.canceled;
    } catch {
      setError(failure);
      return false;
    }
  }, []);

  const remove = async (attachment: Attachment) => {
    setConfirmingId(null);
    const removed = await act(() => removeAttachment(attachment.id), "Could not remove the attachment.");
    // The row is already gone when the file wasn't, so drop it from the table either way.
    if (removed) setAttachments((existing) => existing.filter((a) => a.id !== attachment.id));
  };

  return (
    <section aria-labelledby={headingId} className="shrink-0 border-t">
      <div className="flex items-center gap-2 py-1 pl-4 pr-2">
        <PaperclipIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
          {attachments.length > 0 ? `Attachments (${attachments.length})` : "Attachments"}
        </h3>
        <Button variant="ghost" size="xs" onClick={attach} disabled={busy} className="ml-auto">
          <PlusIcon data-icon="inline-start" />
          Attach files
        </Button>
      </div>

      {error && (
        <p role="alert" className="border-t px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {attachments.length > 0 && (
        <div className="max-h-44 overflow-y-auto border-t">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Name</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="pr-2 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map((attachment) => (
                <TableRow key={attachment.id}>
                  <TableCell className="max-w-0 truncate pl-4 font-medium" title={attachment.fileName}>
                    {attachment.fileName}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatBytes(attachment.size)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(attachment.createdAt)}
                  </TableCell>
                  <TableCell className="pr-2">
                    <div className="flex justify-end gap-0.5">
                      {confirmingId === attachment.id ? (
                        <>
                          <Button variant="destructive" size="xs" onClick={() => remove(attachment)}>
                            Remove {attachment.fileName}?
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => setConfirmingId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Show in Finder"
                            aria-label={`Show ${attachment.fileName} in Finder`}
                            onClick={() => act(() => revealAttachment(attachment.id), "Could not show the file.")}
                          >
                            <FolderOpenIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Save a copy…"
                            aria-label={`Save a copy of ${attachment.fileName}`}
                            onClick={() => act(() => saveAttachmentCopy(attachment.id), "Could not save a copy.")}
                          >
                            <DownloadIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Remove"
                            aria-label={`Remove ${attachment.fileName}`}
                            onClick={() => setConfirmingId(attachment.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2Icon />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
