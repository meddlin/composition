import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { listImages } from "@/lib/composition/client";
import type { ImageInfo } from "@/lib/composition/api";
import { imageMarkdown } from "@/lib/composition/imageRefs";
import { IMAGE_MENU_HEIGHT_PX, IMAGE_MENU_WIDTH_PX, imageOptionId } from "./ImagePickerMenu";
import { matchImages } from "./imagePicker";
import { placeMenu, type Position } from "./useMdxCompletion";

/** Cmd+Shift+M on macOS, Ctrl+Shift+M elsewhere; `aria-keyshortcuts` says the same. */
export const IMAGE_PICKER_SHORTCUT = "Control+Shift+M Meta+Shift+M";

export function isImagePickerShortcut(event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  return event.key.toLowerCase() === "m" && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

/** The text the picker will replace (the caret, or the selected words), and what has been typed to filter the images. */
type Session = { start: number; end: number; label: string; query: string };

/**
 * Inserting an image that is already stored, from the editor's textarea: the
 * shortcut lists the images (newest first) at the caret, typing narrows them,
 * and the chosen one goes in as `![alt](app_data/name)`. Selected words become
 * its alt text. `insert` swaps `[start, end)` for `text` and puts the caret
 * `caret` characters into it.
 */
export function useImagePicker(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
  insert: (start: number, end: number, text: string, caret: number) => void,
) {
  const menuId = useId();
  const [session, setSession] = useState<Session | null>(null);
  const [position, setPosition] = useState<Position>({ left: 0 });
  const [active, setActive] = useState(0);
  // Listed afresh each time the picker opens, so an image pasted a moment ago is there.
  const [images, setImages] = useState<ImageInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  const items = useMemo(() => (images && session ? matchImages(images, session.query) : []), [images, session]);
  const activeIndex = Math.max(0, Math.min(active, items.length - 1));
  const open = session !== null;

  /** Ends the picker; a listing still on its way is then of no interest. */
  function close() {
    request.current++;
    setSession(null);
  }

  /** Clicking elsewhere, or changing the text, ends the picker; call after anything that can move the caret or change the text. */
  function sync(el: HTMLTextAreaElement) {
    if (session && (el.selectionStart !== session.start || el.selectionEnd !== session.end || el.value !== value)) close();
  }

  /** Opens the picker at the caret, or over the selection; the shortcut calls this. */
  function openPicker(el: HTMLTextAreaElement) {
    const { selectionStart: start, selectionEnd: end } = el;
    const id = ++request.current;
    setSession({ start, end, label: el.value.slice(start, end), query: "" });
    setActive(0);
    setImages(null);
    setFailed(false);
    setPosition(placeMenu(el, start, IMAGE_MENU_HEIGHT_PX, IMAGE_MENU_WIDTH_PX));
    listImages().then(
      (listed) => request.current === id && setImages(listed),
      () => request.current === id && setFailed(true),
    );
  }

  function accept(image: ImageInfo) {
    if (!session) return;
    const text = imageMarkdown(image.name, session.label);
    insert(session.start, session.end, text, text.length);
    close();
  }

  function setQuery(query: string) {
    if (!session) return;
    setSession({ ...session, query });
    setActive(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (isImagePickerShortcut(event)) {
      event.preventDefault(); // Keep the browser from claiming it.
      if (open) close();
      else openPicker(event.currentTarget);
      return;
    }
    if (!session) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (items.length > 0) setActive((activeIndex + 1) % items.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        if (items.length > 0) setActive((activeIndex - 1 + items.length) % items.length);
        return;
      case "Enter":
      case "Tab":
        event.preventDefault();
        if (items.length > 0) accept(items[activeIndex]);
        return;
      case "Escape":
        event.preventDefault();
        close();
        return;
    }
    // There is no text in the note to type into, so the picker takes the keys itself.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Backspace") {
      event.preventDefault();
      setQuery(session.query.slice(0, -1));
    } else if (event.key.length === 1) {
      event.preventDefault();
      setQuery(session.query + event.key);
    }
  }

  const style: CSSProperties = { left: position.left, top: position.top, bottom: position.bottom };

  return {
    open,
    menu: {
      id: menuId,
      images: images && session ? items : null,
      failed,
      active: activeIndex,
      style,
      query: session?.query ?? "",
      label: session?.label ?? "",
      onPick: accept,
      onHover: setActive,
    },
    /** Props for the textarea, so assistive tech hears the menu as part of it. */
    textareaProps: {
      "aria-controls": open ? menuId : undefined,
      "aria-activedescendant": open && items.length > 0 ? imageOptionId(menuId, items[activeIndex]) : undefined,
      "aria-keyshortcuts": IMAGE_PICKER_SHORTCUT,
      onKeyDown,
      onSelect: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onScroll: (event: { currentTarget: HTMLTextAreaElement }) => sync(event.currentTarget),
      onBlur: close,
    },
    sync,
  };
}
