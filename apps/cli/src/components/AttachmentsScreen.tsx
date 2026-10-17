import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { homedir } from "node:os";
import path from "node:path";
import type { Api } from "../api";
import { parsePaths, saveCopy } from "../attachmentFiles";
import { formatBytes, type Attachment } from "../backend";
import { actionFor, footerFor } from "../keymap";
import type { Palette } from "../theme";
import { ConfirmDialog, PromptDialog } from "./Dialogs";

/** One row of the table: the name, the size and the day it was attached. */
export function attachmentText(attachment: Attachment, width: number): string {
  const size = formatBytes(attachment.size).padStart(9);
  const added = attachment.createdAt.slice(0, 10);
  const nameWidth = Math.max(8, width - size.length - added.length - 8);
  const name = attachment.fileName.length > nameWidth ? `${attachment.fileName.slice(0, nameWidth - 1)}…` : attachment.fileName.padEnd(nameWidth);
  return `${name}  ${size}  ${added}`;
}

type Step = { kind: "attach" } | { kind: "save"; attachment: Attachment } | { kind: "remove"; attachment: Attachment } | null;

type AttachmentsScreenProps = {
  api: Api;
  noteId: number;
  noteTitle: string;
  palette: Palette;
  width: number;
  onClose: () => void;
};

/**
 * The files attached to one note, as the table the desktop app shows under it. Attaching copies
 * a file in (the original stays where it is); removing deletes the stored copy. A file is never
 * opened from here, for the reason the desktop app doesn't either: it could run.
 */
export function AttachmentsScreen({ api, noteId, noteTitle, palette, width, onClose }: AttachmentsScreenProps) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [index, setIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(null);

  const load = async (selectLast = false) => {
    const next = await api.listAttachments(noteId);
    setItems(next);
    setIndex((current) => (selectLast ? Math.max(0, next.length - 1) : Math.min(current, Math.max(0, next.length - 1))));
  };
  useEffect(() => {
    void load().catch(() => setMessage("The attachments couldn't be read."));
  }, []);

  const selected = items?.[index];
  const fail = (error: unknown) => setMessage(`That didn't work: ${error instanceof Error ? error.message : String(error)}`);

  const attach = async (typed: string) => {
    const paths = parsePaths(typed, process.cwd());
    const result = await api.addAttachmentFiles(noteId, paths);
    const count = result.attachments.length;
    const attached = count === 0 ? "" : `Attached ${count} file${count === 1 ? "" : "s"}. `;
    setMessage(`${attached}${result.error ?? ""}`.trim() || "Nothing was attached.");
    await load(count > 0); // land on the newest file, which is last in the table
  };

  const save = async (attachment: Attachment, destination: string) => {
    const found = await api.findAttachmentFile(attachment.id);
    if (!found) {
      setMessage("That attachment's file is missing from the application data folder.");
      return;
    }
    const result = saveCopy(found.path, found.fileName, destination, process.cwd());
    setMessage("error" in result ? result.error : `Saved a copy to ${result.path}.`);
  };

  const remove = async (attachment: Attachment) => {
    const result = await api.removeAttachment(attachment.id);
    setMessage(result.error ?? `Removed "${attachment.fileName}".`);
    await load();
  };

  useKeyboard((key) => {
    if (step) return; // the prompt or the confirmation has the keyboard
    switch (actionFor("attachments", key)) {
      case "back":
        onClose();
        break;
      case "attach":
        setStep({ kind: "attach" });
        break;
      case "save-copy":
        if (selected) setStep({ kind: "save", attachment: selected });
        break;
      case "remove-attachment":
        if (selected) setStep({ kind: "remove", attachment: selected });
        break;
    }
  });

  const options: SelectOption[] = (items ?? []).map((item) => ({ name: attachmentText(item, width - 6), description: "" }));

  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" flexDirection="column" backgroundColor={palette.background}>
      <box height={1} paddingLeft={1}>
        <text fg={palette.accent}>{`Attachments · ${noteTitle}`}</text>
      </box>
      <box flexGrow={1} border borderStyle="single" borderColor={palette.borderFocused} title=" Name · Size · Added ">
        {items === null ? (
          <text fg={palette.muted}>Loading…</text>
        ) : items.length === 0 ? (
          <text fg={palette.muted}>Nothing is attached to this note. Press a to attach files.</text>
        ) : (
          <select
            focused={!step}
            options={options}
            selectedIndex={index}
            showDescription={false}
            showScrollIndicator
            height="100%"
            backgroundColor={palette.background}
            textColor={palette.foreground}
            focusedBackgroundColor={palette.background}
            focusedTextColor={palette.foreground}
            selectedBackgroundColor={palette.selection}
            selectedTextColor={palette.selectionText}
            onChange={setIndex}
          />
        )}
      </box>
      <box height={1} paddingLeft={1}>
        <text fg={message ? palette.warning : palette.muted}>{message ?? footerFor("attachments", width - 2)}</text>
      </box>

      {step?.kind === "attach" && (
        <PromptDialog
          palette={palette}
          title="Attach files"
          label="Path of a file, or several (quote a name with spaces, or drag the files here)"
          onCancel={() => setStep(null)}
          onSubmit={(typed) => {
            setStep(null);
            void attach(typed).catch(fail);
          }}
        />
      )}
      {step?.kind === "save" && (
        <PromptDialog
          palette={palette}
          title="Save a copy"
          label="Where to save it: a new file name, or a folder"
          initial={path.join(homedir(), step.attachment.fileName)}
          onCancel={() => setStep(null)}
          onSubmit={(destination) => {
            const attachment = step.attachment;
            setStep(null);
            void save(attachment, destination).catch(fail);
          }}
        />
      )}
      {step?.kind === "remove" && (
        <ConfirmDialog
          palette={palette}
          title="Remove attachment"
          message={`Remove "${step.attachment.fileName}"? Its stored copy is deleted for good.`}
          onCancel={() => setStep(null)}
          onConfirm={() => {
            const attachment = step.attachment;
            setStep(null);
            void remove(attachment).catch(fail);
          }}
        />
      )}
    </box>
  );
}
