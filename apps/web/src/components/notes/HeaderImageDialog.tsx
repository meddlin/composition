"use client";

import { UploadIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ImageInfo } from "@/lib/composition/api";
import { listImages, saveImage } from "@/lib/composition/client";
import type { HeaderImageLayout } from "@/lib/composition/frontmatter";
import { maxImageBytes } from "@/lib/composition/imageLimit";
import { IMAGE_EXTENSIONS, imageRef } from "@/lib/composition/imageRefs";
import { imageUrl } from "@/lib/composition/imageUrl";
import { cn } from "@/lib/utils";
import { headerImageName } from "./headerImageSource";

export type HeaderImageChoice = { image: string; layout: HeaderImageLayout };

type Props = {
  /** The note the header image is for; an image uploaded here is stored under its title, as a pasted one is. */
  noteId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the note has now, or null for no header image. */
  header: HeaderImageChoice | null;
  /** Every choice is applied to the note straight away, so the preview behind the dialog shows it. */
  onChange: (header: HeaderImageChoice | null) => void;
};

// What the app stores (PNG, JPEG, GIF, WebP); the bytes are checked on save either way.
const ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp", ...IMAGE_EXTENSIONS.map((ext) => `.${ext}`)].join(",");

const LAYOUTS: { value: HeaderImageLayout; label: string; hint: string }[] = [
  { value: "full", label: "Full width", hint: "A banner across the whole note, cropped to fit." },
  { value: "centered", label: "Centered", hint: "The whole picture at its own size, in the middle." },
];

/**
 * Picks the picture above a note's title from the stored images or from a file uploaded on the spot,
 * and whether it spans the note or sits centered. It writes `headerImage` and `headerImageLayout` into the note's frontmatter, where
 * they can also be typed by hand (an `https://` address works there too).
 */
export function HeaderImageDialog({ noteId, open, onOpenChange, header, onChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Header image</DialogTitle>
          <DialogDescription>Shown above the note’s title in the preview.</DialogDescription>
        </DialogHeader>
        {/* Only mounted while open, so the images are listed afresh each time (one pasted a moment ago is there). */}
        {open && <HeaderImagePicker noteId={noteId} header={header} onChange={onChange} />}
      </DialogContent>
    </Dialog>
  );
}

function HeaderImagePicker({ noteId, header, onChange }: Pick<Props, "noteId" | "header" | "onChange">) {
  const [images, setImages] = useState<ImageInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Remembered while no image is chosen yet, and used for the first one.
  const [layout, setLayout] = useState<HeaderImageLayout>(header?.layout ?? "full");
  const chosen = headerImageName(header?.image);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listImages().then(
      (listed) => current && setImages(listed),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, []);

  /** Stores the file like a pasted image, then makes it the header: the same image never gets stored twice. */
  async function upload(file: File) {
    setUploadError(null);
    if (maxImageBytes !== null && file.size > maxImageBytes) {
      setUploadError(`Images can be at most ${maxImageBytes / (1024 * 1024)} MB.`);
      return;
    }
    setUploading(true);
    try {
      const result = await saveImage({ noteId, fileName: file.name, data: new Uint8Array(await file.arrayBuffer()) });
      if (!result.name) {
        setUploadError(result.error ?? "Could not save the image.");
        return;
      }
      const name = result.name;
      // Newest first, like the listing; an image uploaded again is already there.
      setImages((listed) =>
        listed?.some((image) => image.name === name)
          ? listed
          : [{ name, size: file.size, modifiedAt: new Date().toISOString(), usedIn: [] }, ...(listed ?? [])],
      );
      onChange({ image: imageRef(name), layout });
    } catch {
      setUploadError("Could not save the image.");
    } finally {
      setUploading(false);
    }
  }

  function chooseLayout(next: HeaderImageLayout) {
    setLayout(next);
    if (header) onChange({ image: header.image, layout: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <FieldSet className="gap-2 text-sm">
        <FieldLegend variant="label">Layout</FieldLegend>
        <RadioGroup value={layout} onValueChange={(next) => chooseLayout(next as HeaderImageLayout)} aria-label="Layout" className="gap-2">
          {LAYOUTS.map(({ value, label, hint }) => (
            <Field key={value} orientation="horizontal" className="w-fit gap-3">
              <RadioGroupItem value={value} id={`header-layout-${value}`} />
              <FieldLabel htmlFor={`header-layout-${value}`} className="cursor-pointer gap-2 font-normal">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">{hint}</span>
              </FieldLabel>
            </Field>
          ))}
        </RadioGroup>
      </FieldSet>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Image</h3>
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
            <UploadIcon />
            {uploading ? "Uploading…" : "Upload image…"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            aria-label="Upload an image file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file again still counts.
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
        {uploadError && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {uploadError}
          </p>
        )}
        {header && chosen === null && (
          <p className="mb-2 break-all text-xs text-muted-foreground">Currently {header.image}</p>
        )}
        {images === null && !failed && <p className="text-sm text-muted-foreground">Loading images…</p>}
        {failed && <p className="text-sm text-destructive">Could not load the images.</p>}
        {images?.length === 0 && <p className="text-sm text-muted-foreground">No images yet. Upload one above.</p>}
        {images && images.length > 0 && (
          <ul aria-label="Images" className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {images.map((image) => (
              <li key={image.name}>
                <button
                  type="button"
                  aria-pressed={image.name === chosen}
                  aria-label={image.name}
                  title={image.name}
                  onClick={() => onChange({ image: imageRef(image.name), layout })}
                  className={cn(
                    "block aspect-video w-full overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    image.name === chosen && "ring-2 ring-primary",
                  )}
                >
                  {/* A plain <img>, like NoteImage: the files live outside the build. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(image.name)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {header && (
        <div>
          <Button variant="outline" size="sm" onClick={() => onChange(null)}>
            Remove header image
          </Button>
        </div>
      )}
    </div>
  );
}
