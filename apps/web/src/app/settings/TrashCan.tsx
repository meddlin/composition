"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  permanentlyDeleteGroup,
  permanentlyDeleteNote,
  restoreGroup,
  restoreNote,
  type RestoreResult,
} from "@/lib/composition/client";
import { daysLeft, TRASH_RETENTION_DAYS, type Trash } from "@/lib/composition/trash";

type Item = { kind: "note" | "group"; id: number; name: string; expiresAt: string };

/** What the page said about the last thing the user did. */
type Message = { tone: "success" | "error"; text: string };

function untitled(title: string): string {
  return title.trim() || "Untitled";
}

function expiryLabel(expiresAt: string): string {
  const days = daysLeft(expiresAt);
  return days <= 1 ? "Deleted permanently within a day" : `Deleted permanently in ${days} days`;
}

function restoredMessage(item: Item, result: RestoreResult): Message {
  if (result.error) return { tone: "error", text: result.error };
  if (result.restoredToTopLevel) {
    return {
      tone: "success",
      text:
        item.kind === "note"
          ? `Restored “${item.name}” as an ungrouped note, because its group has been deleted.`
          : `Restored “${item.name}” at the top level, because its parent group has been deleted.`,
    };
  }
  return { tone: "success", text: `Restored “${item.name}”.` };
}

/**
 * The Trash Can: recently deleted notes and groups, which can be restored until
 * they are deleted for good, by hand or after TRASH_RETENTION_DAYS.
 */
export function TrashCan({ initialTrash }: { initialTrash: Trash }) {
  const [trash, setTrash] = useState(initialTrash);
  const [message, setMessage] = useState<Message | null>(null);
  // Deleting for good needs a second, explicit yes.
  const [confirming, setConfirming] = useState<Item | null>(null);
  const [pending, startTransition] = useTransition();

  const items: Item[] = [
    ...trash.notes.map((n) => ({ kind: "note" as const, id: n.id, name: untitled(n.title), expiresAt: n.expiresAt })),
    ...trash.groups.map((g) => ({ kind: "group" as const, id: g.id, name: g.name, expiresAt: g.expiresAt })),
  ];

  function without(item: Item) {
    setTrash((prev) => ({
      notes: item.kind === "note" ? prev.notes.filter((n) => n.id !== item.id) : prev.notes,
      groups: item.kind === "group" ? prev.groups.filter((g) => g.id !== item.id) : prev.groups,
    }));
  }

  function restore(item: Item) {
    setMessage(null);
    startTransition(async () => {
      const result = await (item.kind === "note" ? restoreNote(item.id) : restoreGroup(item.id));
      // A refusal means it's already gone from the Trash Can (another window), so drop it either way.
      without(item);
      setMessage(restoredMessage(item, result));
    });
  }

  function deleteForever(item: Item) {
    setConfirming(null);
    setMessage(null);
    startTransition(async () => {
      await (item.kind === "note" ? permanentlyDeleteNote(item.id) : permanentlyDeleteGroup(item.id));
      without(item);
      setMessage({ tone: "success", text: `Permanently deleted “${item.name}”.` });
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle
          role="heading"
          aria-level={2}
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Trash Can
        </CardTitle>
        <CardDescription>
          Recently deleted notes and groups. Items are permanently deleted automatically after{" "}
          {TRASH_RETENTION_DAYS} days in the Trash Can.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-destructive" : "text-success"}>
            {message.text}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-muted-foreground">The Trash Can is empty.</p>
        ) : (
          <>
            <TrashList heading="Notes" items={items.filter((i) => i.kind === "note")} busy={pending} onRestore={restore} onDelete={setConfirming} />
            <TrashList heading="Groups" items={items.filter((i) => i.kind === "group")} busy={pending} onRestore={restore} onDelete={setConfirming} />
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        title={`Permanently delete “${confirming?.name ?? ""}”?`}
        description="This can't be undone. It will be gone for good."
        confirmLabel="Delete permanently"
        onConfirm={() => confirming && deleteForever(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </Card>
  );
}

function TrashList({
  heading,
  items,
  busy,
  onRestore,
  onDelete,
}: {
  heading: string;
  items: Item[];
  busy: boolean;
  onRestore: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-label={heading} className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{heading}</h3>
      <ul className="flex flex-col divide-y">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{item.name}</div>
              {/* The count depends on the clock, which the server render and the browser may read a moment apart. */}
              <div suppressHydrationWarning className="text-xs text-muted-foreground">
                {expiryLabel(item.expiresAt)}
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onRestore(item)} aria-label={`Restore ${item.name}`}>
              Restore
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => onDelete(item)} aria-label={`Permanently delete ${item.name}`}>
              Delete permanently
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
