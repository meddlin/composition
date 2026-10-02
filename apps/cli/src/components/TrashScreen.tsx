import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import type { Api } from "../api";
import { daysLeft, TRASH_RETENTION_DAYS, type Trash } from "../backend";
import { actionFor, footerFor } from "../keymap";
import type { Palette } from "../theme";
import { ConfirmDialog } from "./Dialogs";

type Item = { kind: "note" | "group"; id: number; label: string; deletedAt: string; expiresAt: string };

/** Notes and groups together, the most recently deleted first. */
export function trashItems(trash: Trash): Item[] {
  return [
    ...trash.notes.map((n): Item => ({ kind: "note", id: n.id, label: n.title, deletedAt: n.deletedAt, expiresAt: n.expiresAt })),
    ...trash.groups.map((g): Item => ({ kind: "group", id: g.id, label: g.name, deletedAt: g.deletedAt, expiresAt: g.expiresAt })),
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function itemText(item: Item): string {
  const left = daysLeft(item.expiresAt);
  const kind = item.kind === "note" ? "note " : "group";
  return `${kind}  ${item.label}   deleted ${item.deletedAt.slice(0, 10)} · ${left} day${left === 1 ? "" : "s"} left`;
}

type TrashScreenProps = {
  api: Api;
  palette: Palette;
  width: number;
  onClose: () => void;
};

/**
 * Everything deleted in the last 60 days. Restoring puts a note back where it was (at the
 * top level if its group is gone) and into the search index; deleting here is for good.
 */
export function TrashScreen({ api, palette, width, onClose }: TrashScreenProps) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [index, setIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Item | null>(null);

  const load = async () => {
    const next = trashItems(await api.loadTrash());
    setItems(next);
    setIndex((current) => Math.min(current, Math.max(0, next.length - 1)));
  };
  useEffect(() => {
    void load().catch(() => setMessage("The Trash Can couldn't be read."));
  }, []);

  const selected = items?.[index];

  const restore = async (item: Item) => {
    const result = item.kind === "note" ? await api.restoreNote(item.id) : await api.restoreGroup(item.id);
    setMessage(
      result.error ??
        `Restored "${item.label}"${result.restoredToTopLevel ? " at the top level, because its group is gone" : ""}.`,
    );
    await load();
  };

  const deleteForever = async (item: Item) => {
    if (item.kind === "note") await api.permanentlyDeleteNote(item.id);
    else await api.permanentlyDeleteGroup(item.id);
    setMessage(`Deleted "${item.label}" for good.`);
    await load();
  };

  useKeyboard((key) => {
    if (confirming) return; // the confirmation has the keyboard
    switch (actionFor("trash", key)) {
      case "back":
        onClose();
        break;
      case "restore":
        if (selected) void restore(selected).catch((e) => setMessage(`That didn't work: ${e instanceof Error ? e.message : e}`));
        break;
      case "delete-forever":
        if (selected) setConfirming(selected);
        break;
    }
  });

  const options: SelectOption[] = (items ?? []).map((item) => ({ name: itemText(item), description: "" }));

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={palette.background}
    >
      <box height={1} paddingLeft={1}>
        <text fg={palette.accent}>Trash Can</text>
      </box>
      <box
        flexGrow={1}
        border
        borderStyle="single"
        borderColor={palette.borderFocused}
        title={` Deleted in the last ${TRASH_RETENTION_DAYS} days `}
      >
        {items === null ? (
          <text fg={palette.muted}>Loading…</text>
        ) : items.length === 0 ? (
          <text fg={palette.muted}>The Trash Can is empty.</text>
        ) : (
          <select
            focused={!confirming}
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
        <text fg={message ? palette.warning : palette.muted}>{message ?? footerFor("trash", width - 2)}</text>
      </box>

      {confirming && (
        <ConfirmDialog
          palette={palette}
          title="Delete for good"
          message={`Delete "${confirming.label}" for good? This can't be undone.`}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const item = confirming;
            setConfirming(null);
            void deleteForever(item).catch((e) => setMessage(`That didn't work: ${e instanceof Error ? e.message : e}`));
          }}
        />
      )}
    </box>
  );
}
