import { PencilIcon } from "lucide-react";
import { useContext } from "react";
import { DIAGRAM_DENSITY } from "@/lib/composition/drawio";
import { imageNameFromRef } from "@/lib/composition/imageRefs";
import { DrawioEditContext } from "../DrawioEdit";
import { NoteImage } from "../NoteImage";
import { imageWidthCss } from "./imageWidth";

/**
 * A draw.io diagram, written in a note as `<Drawio src="app_data/…" alt="…" />`. It is drawn as the
 * picture it is stored as (a PNG with the diagram inside, so it is an ordinary image to everything else:
 * backups, the Images page, the terminal app), with an **Edit** button that opens it in the draw.io
 * editor. `width` is as for `<Image>`; see imageWidth.ts.
 */
export function Drawio({ src, alt, title, width }: { src?: string; alt?: string; title?: string; width?: string }) {
  const editing = useContext(DrawioEditContext);

  if (!src) return <span className="text-muted-foreground italic">Diagram: add a src</span>;
  // Only a diagram stored with the notes can be opened again; one from a web address is just shown.
  const name = imageNameFromRef(src);

  return (
    // The box takes the width, so the Edit button sits on the picture's corner, not the note's. The box has the
    // spacing: Typography's own margin on images would push the picture below the corner the button is anchored to.
    <span className="group relative my-4 inline-block max-w-full align-top [&_img]:my-0" style={{ width: imageWidthCss(width) }}>
      <NoteImage src={src} alt={alt} title={title} width={imageWidthCss(width) ? "100%" : undefined} density={DIAGRAM_DENSITY} />
      {editing && name && (
        <button
          type="button"
          onClick={() => editing.edit(name)}
          className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border bg-popover/95 px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <PencilIcon className="size-3" />
          Edit diagram
        </button>
      )}
    </span>
  );
}
