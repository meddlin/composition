"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { matchImages, formatSize, usageLabel } from "@/components/notes/imagePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ImageInfo } from "@/lib/composition/api";
import { imageMarkdown, imageRef } from "@/lib/composition/imageRefs";
import { imageUrl } from "@/lib/composition/imageUrl";
import { cn } from "@/lib/utils";

type Filter = "all" | "unused";

/** The date in UTC, so the server-rendered page and the browser agree on it. */
const addedOn = (image: ImageInfo) => image.modifiedAt.slice(0, 10);

const untitled = (title: string) => title.trim() || "Untitled";

/**
 * Every image stored with the notes, as thumbnails. Pasting an image is the
 * only way to add one, and deleting the text that points at it leaves the file
 * behind, so this is where it is found and copied again instead of pasted twice.
 */
export function ImageLibrary({ images }: { images: ImageInfo[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const unused = useMemo(() => images.filter((image) => image.usedIn.length === 0), [images]);
  const shown = useMemo(() => matchImages(filter === "unused" ? unused : images, query, Infinity), [filter, unused, images, query]);
  const selected = images.find((image) => image.name === selectedName) ?? null;

  if (images.length === 0) {
    return (
      <p className="text-muted-foreground">
        No images yet. Paste an image into a note and it will appear here, ready to use again.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by file name"
          aria-label="Filter images"
          className="max-w-xs"
        />
        <div role="group" aria-label="Show" className="flex gap-1">
          <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All ({images.length})
          </Button>
          <Button
            size="sm"
            variant={filter === "unused" ? "secondary" : "ghost"}
            aria-pressed={filter === "unused"}
            onClick={() => setFilter("unused")}
          >
            Not used ({unused.length})
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground">
          {filter === "unused" && query === "" ? "Every image is used in a note." : "No images match."}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((image) => (
            <li key={image.name}>
              <button
                type="button"
                onClick={() => setSelectedName(image.name)}
                className="group flex w-full flex-col gap-1.5 rounded-xl p-2 text-left ring-1 ring-foreground/10 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* A plain <img>, like NoteImage: the files live outside the build. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(image.name)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full rounded-md bg-muted object-contain"
                />
                <span className="truncate font-mono text-xs" title={image.name}>
                  {image.name}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {image.usedIn.length === 0 ? (
                    <Badge variant="secondary">Not used</Badge>
                  ) : (
                    <span>{usageLabel(image)}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelectedName(null)}>
        <DialogContent>{selected && <ImageDetails image={selected} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function ImageDetails({ image }: { image: ImageInfo }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-all font-mono text-sm">{image.name}</DialogTitle>
        <DialogDescription>
          {formatSize(image.size)} · added {addedOn(image)}
        </DialogDescription>
      </DialogHeader>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl(image.name)} alt="" className="max-h-[50vh] w-full rounded-md bg-muted object-contain" />

      <div className="flex flex-col gap-2">
        <CopyRow label="Markdown" text={imageMarkdown(image.name)} />
        <CopyRow label="Component" text={`<Image src="${imageRef(image.name)}" alt="" />`} />
      </div>

      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{usageLabel(image)}</h3>
        {image.usedIn.length > 0 ? (
          <ul className="list-inside list-disc">
            {image.usedIn.map((note) => (
              <li key={note.id}>{untitled(note.title)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nothing refers to this file now. Copy its Markdown into a note to use it again.</p>
        )}
      </div>
    </>
  );
}

/** A snippet to paste into a note, and a button that copies it. */
function CopyRow({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs" title={text}>
        {text}
      </code>
      <Button size="sm" variant="outline" onClick={copy} aria-label={`Copy ${label}`}>
        {state === "copied" ? <CheckIcon /> : <CopyIcon />}
        <span className={cn(state === "failed" && "text-destructive")}>
          {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
        </span>
      </Button>
    </div>
  );
}
