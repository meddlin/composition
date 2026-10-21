import { useEffect, type CSSProperties } from "react";
import type { ImageInfo } from "@/lib/composition/api";
import { imageUrl } from "@/lib/composition/imageUrl";
import { cn } from "@/lib/utils";
import { formatSize, usageLabel } from "./imagePicker";

export const IMAGE_MENU_WIDTH_PX = 340;
/** Roughly the tallest the menu gets: its header, a full list and its hint. */
export const IMAGE_MENU_HEIGHT_PX = 400;

type Props = {
  id: string;
  /** The images that match, or null while they are being fetched. */
  images: ImageInfo[] | null;
  /** The images could not be listed. */
  failed: boolean;
  active: number;
  /** Where to put it within the editor pane. */
  style: CSSProperties;
  /** What has been typed to filter by (there is no text in the note to show it), and the words the image will describe. */
  query: string;
  label: string;
  onPick: (image: ImageInfo) => void;
  onHover: (index: number) => void;
};

export const imageOptionId = (menuId: string, image: ImageInfo) => `${menuId}-${image.name}`;

/**
 * The images already stored, shown at the caret to insert one again. The
 * textarea keeps focus the whole time (it points here with aria-activedescendant),
 * so the menu only needs to handle the mouse.
 */
export function ImagePickerMenu({ id, images, failed, active, style, query, label, onPick, onHover }: Props) {
  const activeName = images?.[active]?.name;
  useEffect(() => {
    if (activeName) document.getElementById(`${id}-${activeName}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, activeName]);

  return (
    <div
      style={{ ...style, width: IMAGE_MENU_WIDTH_PX }}
      className="absolute z-10 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">
        {label ? `Insert image “${label}”: ` : "Insert image: "}
        <span className="text-foreground">{query || "type to filter"}</span>
      </div>
      <div id={id} role="listbox" aria-label="Images" className="max-h-80 overflow-y-auto">
        {images?.map((image, index) => (
          <div
            key={image.name}
            id={imageOptionId(id, image)}
            role="option"
            aria-selected={index === active}
            // Keep focus (and the caret) in the textarea.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(image);
            }}
            onMouseMove={() => onHover(index)}
            className={cn(
              "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5",
              index === active && "bg-accent text-accent-foreground",
            )}
          >
            {/* A plain <img>, like NoteImage: the files live outside the build. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(image.name)}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-10 shrink-0 rounded-sm bg-muted object-cover"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs">{image.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {usageLabel(image)} · {formatSize(image.size)}
              </span>
            </span>
          </div>
        ))}
      </div>
      {images === null && !failed && <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading images…</div>}
      {failed && <div className="px-2 py-1.5 text-sm text-destructive">Could not load the images.</div>}
      {images?.length === 0 && (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">{query ? "No matching images" : "No images yet. Paste one into a note."}</div>
      )}
      <div className="border-t px-2 py-1 text-xs text-muted-foreground">↑↓ choose · Enter insert · Esc close</div>
    </div>
  );
}
