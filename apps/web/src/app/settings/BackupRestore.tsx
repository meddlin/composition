"use client";

import { useEffect, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatBytes } from "@/lib/composition/attachmentNames";
import { describeCounts, type BackupResult } from "@/lib/composition/backupApi";
import { BACKUP_NEEDS_PATH, createBackup, restoreBackup } from "@/lib/composition/backupClient";

/** What the page said about the last thing the user did. */
type Message = { tone: "success" | "error"; text: string };

/**
 * A restore replaces everything the page was rendered from (the color scheme, the
 * favorites, the notes), so the page reloads afterwards; the outcome is carried
 * across the reload here.
 */
const RESTORED_KEY = "composition:backup-restored";

function rememberAcrossReload(message: Message): void {
  try {
    sessionStorage.setItem(RESTORED_KEY, JSON.stringify(message));
  } catch {
    // storage blocked: the page still reloads, just without the confirmation
  }
}

function readRememberedMessage(): Message | null {
  try {
    const raw = sessionStorage.getItem(RESTORED_KEY);
    return raw === null ? null : (JSON.parse(raw) as Message);
  } catch {
    return null;
  }
}

function forgetRememberedMessage(): void {
  try {
    sessionStorage.removeItem(RESTORED_KEY);
  } catch {
    // nothing to forget
  }
}

function backedUpMessage(result: BackupResult): Message {
  const what = result.counts ? `${describeCounts(result.counts)} ` : "";
  const size = result.bytes === undefined ? "" : ` (${formatBytes(result.bytes)})`;
  return { tone: "success", text: `Backed up ${what}to ${result.file}${size}.` };
}

function restoredMessage(result: BackupResult): Message {
  const what = result.counts ? `${describeCounts(result.counts)} ` : "";
  const safety = result.safetyBackup ? ` What was here before is saved in ${result.safetyBackup}.` : "";
  return { tone: "success", text: `Restored ${what}from ${result.file}.${safety}` };
}

function MessageLine({ message }: { message: Message | null }) {
  if (!message) return null;
  return (
    <p
      role={message.tone === "error" ? "alert" : "status"}
      className={`break-words ${message.tone === "error" ? "text-destructive" : "text-success"}`}
    >
      {message.text}
    </p>
  );
}

const SECTION_TITLE = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * The Backup and Restore sections of the Settings screen. In the web app the
 * person types a folder or file path; in the desktop app a button opens the
 * operating system's save or open dialog (BACKUP_NEEDS_PATH).
 */
export function BackupRestore({ defaultBackupDir }: { defaultBackupDir: string }) {
  const [directory, setDirectory] = useState(defaultBackupDir);
  const [file, setFile] = useState("");
  const [backupMessage, setBackupMessage] = useState<Message | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<Message | null>(null);
  // Restoring replaces everything, so it needs a second, explicit yes.
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  // After a restore the page reloaded; say what happened. Read on the client only (storage doesn't exist on the server render).
  useEffect(() => {
    const remembered = readRememberedMessage();
    if (!remembered) return;
    // Removed only once shown: development's double-run of effects must not eat it.
    const timer = setTimeout(() => {
      setRestoreMessage(remembered);
      forgetRememberedMessage();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function backUp() {
    setBackupMessage(null);
    startTransition(async () => {
      try {
        const result = await createBackup(directory);
        if (result.canceled) return;
        setBackupMessage(result.error ? { tone: "error", text: result.error } : backedUpMessage(result));
      } catch (error) {
        setBackupMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  function restore() {
    setConfirming(false);
    setRestoreMessage(null);
    startTransition(async () => {
      try {
        const result = await restoreBackup(file);
        if (result.canceled) return;
        if (result.error) {
          setRestoreMessage({ tone: "error", text: result.error });
          return;
        }
        const message = restoredMessage(result);
        setRestoreMessage(message);
        rememberAcrossReload(message);
        window.location.reload();
      } catch (error) {
        setRestoreMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  return (
    <>
      <Card size="sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
            Backup
          </CardTitle>
          <CardDescription>
            Saves your notes, groups, Trash Can, images, attached files and these settings (color scheme, city, column
            sizes, favorites) in one file. Where your data lives on this computer isn&apos;t included.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {BACKUP_NEEDS_PATH && (
            <Field className="gap-1">
              <FieldLabel htmlFor="backupDir">Backup folder</FieldLabel>
              <FieldDescription className="text-xs">
                A new file named <span className="font-mono">composition-backup-…tar.gz</span> is added each time.
              </FieldDescription>
              <Input
                id="backupDir"
                type="text"
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          )}
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending || (BACKUP_NEEDS_PATH && directory.trim() === "")}
            onClick={backUp}
            className="w-fit px-4"
          >
            {pending ? "Working…" : BACKUP_NEEDS_PATH ? "Create backup" : "Create backup…"}
          </Button>
          <MessageLine message={backupMessage} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
            Restore
          </CardTitle>
          <CardDescription>
            Replaces everything in Composition with the contents of a backup. What is here now is saved to a backup of
            its own first, so a restore can be undone. Close other Composition windows and apps before restoring.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {BACKUP_NEEDS_PATH && (
            <Field className="gap-1">
              <FieldLabel htmlFor="backupFile">Backup file</FieldLabel>
              <FieldDescription className="text-xs">
                The full path of a <span className="font-mono">.tar.gz</span> made by Create backup.
              </FieldDescription>
              <Input
                id="backupFile"
                type="text"
                value={file}
                onChange={(event) => setFile(event.target.value)}
                placeholder={`${defaultBackupDir}/composition-backup-….tar.gz`}
                spellCheck={false}
                className="font-mono"
              />
            </Field>
          )}
          <Button
            type="button"
            variant="destructive"
            size="lg"
            disabled={pending || (BACKUP_NEEDS_PATH && file.trim() === "")}
            onClick={() => setConfirming(true)}
            className="w-fit px-4"
          >
            {BACKUP_NEEDS_PATH ? "Restore…" : "Restore from backup…"}
          </Button>
          <MessageLine message={restoreMessage} />
        </CardContent>
        <ConfirmDialog
          open={confirming}
          title="Replace everything with a backup?"
          description="Every note, group, image, attached file and setting here is replaced with what is in the backup. What is here now is saved first, so you can go back."
          confirmLabel="Restore"
          onConfirm={restore}
          onCancel={() => setConfirming(false)}
        />
      </Card>
    </>
  );
}
