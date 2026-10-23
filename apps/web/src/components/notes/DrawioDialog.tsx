"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveImage } from "@/lib/composition/client";
import {
  DIAGRAM_FILE_NAME,
  dataUriFromPngBytes,
  drawioEditorUrl,
  drawioOrigin,
  exportMessage,
  hasEmbeddedDiagram,
  loadMessage,
  parseDrawioMessage,
  pngBytesFromDataUri,
} from "@/lib/composition/drawio";
import { DRAWIO_BASE } from "@/lib/composition/drawioBase";
import { maxImageBytes } from "@/lib/composition/imageLimit";
import { imageUrl } from "@/lib/composition/imageUrl";

/** What the editor opens with: nothing (a new diagram), or the stored picture of one to change. */
export type DrawioSource = { kind: "new" } | { kind: "edit"; name: string };

type Props = {
  open: boolean;
  /** The note the diagram is for; it is stored under the note's title, as a pasted image is. */
  noteId: number;
  source: DrawioSource;
  /** Closed without saving. */
  onClose: () => void;
  /** Saved: the stored file's name (`app_data/<name>` is what the note refers to). */
  onSaved: (name: string) => void;
};

/**
 * The draw.io editor in a dialog, for drawing a diagram to put in a note or changing one already
 * there. The editor is an iframe (vendored, see drawio.lock.json) that this talks to over
 * `postMessage` (drawio.ts); **Save** has it hand over the diagram as a PNG with the diagram's XML
 * inside, which is stored like any pasted image, so the file is also what the note shows.
 */
export function DrawioDialog({ open, ...props }: Props) {
  // Mounted only while open, so each opening starts fresh: a new editor, nothing left unsaved.
  return open ? <DrawioSession {...props} /> : null;
}

/** Whether the app is showing a dark color scheme, from what its page background paints as. */
function appIsDark(): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) return false;
    // The canvas takes any CSS color the browser does (oklch included) and hands back plain pixels.
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
  } catch {
    return false;
  }
}

type Phase = "loading" | "ready" | "saving";

function DrawioSession({ noteId, source, onClose, onSaved }: Omit<Props, "open">) {
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = useMemo(() => drawioOrigin(DRAWIO_BASE, window.location.origin), []);
  const editorUrl = useMemo(() => drawioEditorUrl(DRAWIO_BASE, { dark: appIsDark() }), []);
  // The stored picture to open (a data address) or null for a new diagram; undefined while it is being read.
  const [picture, setPicture] = useState<string | null | undefined>(source.kind === "new" ? null : undefined);
  const [phase, setPhase] = useState<Phase>("loading");
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editName = source.kind === "edit" ? source.name : null;
  useEffect(() => {
    if (editName === null) return;
    let current = true;
    (async () => {
      try {
        const response = await fetch(imageUrl(editName));
        if (!response.ok) throw new Error("The diagram's picture could not be read.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!hasEmbeddedDiagram(bytes)) {
          throw new Error(
            "This picture has no diagram inside it to edit. Only diagrams drawn here, or exported from draw.io as a PNG with the diagram included, can be.",
          );
        }
        if (current) setPicture(dataUriFromPngBytes(bytes));
      } catch (reason) {
        if (current) setError(reason instanceof Error ? reason.message : "The diagram could not be opened.");
      }
    })();
    return () => {
      current = false;
    };
  }, [editName]);

  /** Stores what the editor exported and tells the note. */
  async function finish(data: unknown) {
    const bytes = pngBytesFromDataUri(data);
    if (!bytes) return fail("The editor did not return a picture.");
    const limit = maxImageBytes;
    if (limit !== null && bytes.length > limit) return fail(`The diagram is too big to store: images can be at most ${limit / (1024 * 1024)} MB.`);
    try {
      const result = await saveImage({ noteId, fileName: DIAGRAM_FILE_NAME, data: bytes });
      if (result.name) onSaved(result.name);
      else fail(result.error ?? "The diagram could not be saved.");
    } catch {
      fail("The diagram could not be saved.");
    }
  }

  function fail(message: string) {
    setError(message);
    setPhase("ready");
  }

  function save() {
    if (phase !== "ready") return;
    setError(null);
    setPhase("saving");
    frame.current?.contentWindow?.postMessage(exportMessage(), origin);
  }

  function cancel() {
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onClose();
  }

  // The listener is set again on every render, so it always sees the current phase and picture.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Only the editor we opened: other frames, and other pages that learned this window's handle, are ignored.
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      const message = parseDrawioMessage(event.data);
      if (!message) return;
      switch (message.event) {
        case "init":
          frame.current?.contentWindow?.postMessage(loadMessage(picture ?? null), origin);
          break;
        case "load":
          setPhase("ready");
          break;
        case "autosave":
          setDirty(true);
          break;
        case "save": // Ctrl/Cmd+S inside the editor
          save();
          break;
        case "export":
          if (phase === "saving") void finish(message.data);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  return (
    <Dialog open onOpenChange={(next) => !next && cancel()}>
      <DialogContent
        // Drawing is work worth keeping: a stray click outside, or Escape pressed in the dialog, only asks.
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          cancel();
        }}
        className="flex h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col sm:max-w-6xl"
      >
        <DialogHeader>
          <DialogTitle>{source.kind === "new" ? "New diagram" : "Edit diagram"}</DialogTitle>
          <DialogDescription className="sr-only">
            Draw with draw.io, then Save to put the diagram in the note. It stays editable: it is stored as a picture with the drawing inside.
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
          {picture !== undefined && (
            <iframe
              ref={frame}
              src={editorUrl}
              title="draw.io editor"
              // The editor runs scripts and keeps its settings (so it needs its own origin, which the desktop app gives it).
              sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-downloads"
              className="size-full border-0"
            />
          )}
          {phase === "loading" && !error && (
            <p role="status" className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              Loading the editor…
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <p role={error ? "alert" : confirmDiscard ? "status" : undefined} className="min-w-0 flex-1 text-xs text-destructive">
            {error}
            {confirmDiscard && !error && <span className="text-foreground">Discard what you drew?</span>}
          </p>
          {confirmDiscard ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button variant="destructive" size="sm" onClick={onClose}>
                Discard
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={cancel}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={phase !== "ready"}>
                {phase === "saving" ? "Saving…" : "Save diagram"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
