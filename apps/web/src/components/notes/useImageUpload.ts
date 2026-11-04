import { useEffect, useRef, useState } from "react";
import { saveImage } from "@/lib/composition/client";
import { imageRef } from "@/lib/composition/imageRefs";
import { maxImageBytes } from "@/lib/composition/imageLimit";
import type { EditorSurface } from "./editorSurface";

/** Markdown image syntax is `![alt](path)`, so brackets in the alt text must go. */
const altTextFor = (fileName: string) => fileName.replace(/\.[^.]*$/, "").replace(/[[\]\r\n]+/g, " ").trim() || "image";

/** What a paste is, as much as is needed here: a React one from a textarea and a native one from the live editor both fit. */
type PasteEvent = { clipboardData: DataTransfer | null; preventDefault(): void };

type Options = {
  /** The note the pictures are filed under. */
  noteId: number;
  /** The editor that is showing; a picture that finishes uploading goes into whichever it is by then. */
  surface: EditorSurface;
  /**
   * The note's text right now. Uploads finish after the render that started them, so they edit the latest text,
   * not a captured copy, and one that has just changed the text (and not yet been rendered) counts.
   */
  readText: () => string;
};

/**
 * Pasting pictures into the editor: a placeholder goes in at once (in place of the selection), the picture is
 * saved in the background, and the placeholder is then swapped for the Markdown that shows it, or taken away with
 * a reason in `error`. The caret stays where the user has moved it in the meantime.
 */
export function useImageUpload({ noteId, surface, readText }: Options) {
  const [error, setError] = useState<string | null>(null);
  const uploads = useRef(0);
  const latest = useRef({ surface, readText });
  useEffect(() => {
    latest.current = { surface, readText };
  });

  /** Swaps `placeholder` for `replacement`, keeping the caret where the user left it. */
  function resolvePlaceholder(placeholder: string, replacement: string) {
    const { surface: editor, readText: read } = latest.current;
    const start = read().indexOf(placeholder);
    if (start === -1) return;
    const end = start + placeholder.length;
    // Only an editor the user is in has a caret worth keeping; otherwise it is left as the editor has it.
    let caret: number | null = null;
    if (editor.hasFocus()) {
      const shift = replacement.length - placeholder.length;
      const at = editor.selection().start;
      const kept = at >= end ? at + shift : at > start ? start + replacement.length : at;
      caret = kept - start;
    }
    editor.replace(start, end, replacement, caret);
  }

  /** Puts a placeholder where the image goes, uploads in the background, and returns where the placeholder ends. */
  function insertImage(file: File, start: number, end: number): number {
    const placeholder = `[Uploading ${altTextFor(file.name)} (${++uploads.current})…]`;
    latest.current.surface.replace(start, end, placeholder, placeholder.length);
    void upload(file, placeholder);
    return start + placeholder.length;
  }

  async function upload(file: File, placeholder: string) {
    let failure: string | null = null;
    let markdown = "";
    try {
      const result = await saveImage({
        noteId,
        fileName: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      });
      if (result.name) markdown = `![${altTextFor(file.name)}](${imageRef(result.name)})`;
      else failure = result.error ?? "Could not save the image.";
    } catch {
      failure = "Could not save the image.";
    }
    if (failure) setError(failure);
    resolvePlaceholder(placeholder, markdown);
  }

  /** Handles a paste: one that is pictures and no text is taken over; anything else is left to the browser. */
  function paste(event: PasteEvent) {
    const data = event.clipboardData;
    if (!data) return;
    const images = [...data.files].filter((file) => file.type.startsWith("image/"));
    // Cells copied from a spreadsheet arrive as text and a picture of that text; the text is what was meant.
    if (images.length === 0 || data.getData("text/plain") !== "") return;
    event.preventDefault();
    setError(null);

    const { start, end } = latest.current.surface.selection();
    const limit = maxImageBytes;
    if (limit !== null && images.some((file) => file.size > limit)) {
      setError(`Images can be at most ${limit / (1024 * 1024)} MB.`);
      return;
    }
    // The first replaces the selection; any others follow it.
    let at = insertImage(images[0], start, end);
    for (const file of images.slice(1)) at = insertImage(file, at, at);
  }

  return { error, paste };
}
