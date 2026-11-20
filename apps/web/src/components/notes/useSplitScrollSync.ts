import { type RefObject, useEffect, useRef } from "react";
import { BLOCK_SOURCE_ATTRIBUTE } from "./rehypeBlockSources";
import { type Block, follow, marksOf, type Mark, offsetAtY, parseBlockSource, yAtOffset } from "./scrollSync";

type Side = "editor" | "preview";

// What shapes text layout in a textarea; copied onto the mirror so it wraps identically (as caretCoordinates does).
const LAYOUT_PROPERTIES = [
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
  "text-align",
  "tab-size",
  "direction",
] as const;

/** How long after a wheel, touch, key or pointer on a side it still counts as the one being scrolled by hand. */
const HAND_MS = 600;

/**
 * Where the textarea draws each place in `offsets`, from the top of its content (ignoring its scroll): one invisible
 * copy of it, laid out once, with an empty marker at each place. `bottom` is the bottom of the line a place is on.
 */
function editorPlaces(el: HTMLTextAreaElement, offsets: readonly number[]): { top: number; bottom: number }[] {
  const computed = getComputedStyle(el);
  const mirror = document.createElement("div");
  const { style } = mirror;
  for (const property of LAYOUT_PROPERTIES) style.setProperty(property, computed.getPropertyValue(property));
  style.width = `${el.clientWidth}px`;
  style.borderWidth = "0";
  style.position = "absolute";
  style.top = "0";
  style.left = "-99999px";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.overflowWrap = "break-word";
  const text = el.value;
  const order = offsets.map((offset, index) => ({ offset: Math.min(Math.max(offset, 0), text.length), index })).sort((a, b) => a.offset - b.offset);
  const markers: HTMLSpanElement[] = new Array(offsets.length);
  let at = 0;
  for (const { offset, index } of order) {
    if (offset > at) mirror.append(document.createTextNode(text.slice(at, offset)));
    at = offset;
    const marker = document.createElement("span");
    markers[index] = marker;
    mirror.append(marker);
  }
  mirror.append(document.createTextNode(text.slice(at) + "\n"));
  document.body.append(mirror);
  const line = parseFloat(computed.lineHeight) || 20;
  const places = markers.map((marker) => ({ top: marker.offsetTop, bottom: marker.offsetTop + line }));
  mirror.remove();
  return places;
}

/**
 * Keeps the editor and the preview of Split at the same place in the note: scrolling one scrolls the other to the
 * matching spot (`scrollSync.ts`). The preview's top-level blocks say where they are written
 * (`rehypeBlockSources`), and the editor is measured at the same places.
 *
 * Which side leads: the one scrolled by hand (wheel, touch, scrollbar, keys) in the last moment; otherwise the
 * editor, which also scrolls by itself as the caret moves, as text is typed and as find moves to a match, so the
 * preview stays with it. A scroll this makes is never followed back, and neither is one of the preview's that nobody
 * made (the browser keeping its place while the preview is drawn again).
 */
export function useSplitScrollSync(
  enabled: boolean,
  textarea: RefObject<HTMLTextAreaElement | null>,
  previewBox: RefObject<HTMLDivElement | null>,
  value: string,
  body: string,
) {
  // Read inside the listeners, which are set up once per `enabled`; kept current before the effects below run.
  const latest = useRef({ value, body });
  useEffect(() => {
    latest.current = { value, body };
  }, [value, body]);
  const resync = useRef<() => void>(() => {});

  useEffect(() => {
    const editor = textarea.current;
    const preview = previewBox.current;
    if (!enabled || !editor || !preview) return;

    const byHandUntil: Record<Side, number> = { editor: 0, preview: 0 };
    // The scrollTop this last gave each side: the scroll event that follows is its own, not one to follow back.
    const expected: Record<Side, number | null> = { editor: null, preview: null };
    let editorCache: { value: string; width: number; key: string; marks: Mark[] } | null = null;

    const byHand = (side: Side) => () => {
      const now = performance.now();
      byHandUntil[side] = now + HAND_MS;
      byHandUntil[side === "editor" ? "preview" : "editor"] = 0;
    };
    const handled = (side: Side) => performance.now() < byHandUntil[side];

    /** The preview's blocks, with where each is written in the whole note and where it is drawn in the preview's content. */
    const blocks = (): Block[] => {
      const { value: text, body: shown } = latest.current;
      const shift = text.endsWith(shown) ? text.length - shown.length : 0;
      const box = preview.getBoundingClientRect();
      const out: Block[] = [];
      for (const el of preview.querySelectorAll<HTMLElement>(`[${BLOCK_SOURCE_ATTRIBUTE}]`)) {
        const place = parseBlockSource(el.getAttribute(BLOCK_SOURCE_ATTRIBUTE), shift);
        if (!place) continue;
        const rect = el.getBoundingClientRect();
        const top = rect.top - box.top + preview.scrollTop;
        out.push({ ...place, top, bottom: top + rect.height });
      }
      return out;
    };

    const marks = (): { editor: Mark[]; preview: Mark[] } => {
      const found = blocks();
      const text = latest.current.value;
      const key = found.map((b) => `${b.start}-${b.end}`).join(",");
      if (!editorCache || editorCache.value !== text || editorCache.width !== editor.clientWidth || editorCache.key !== key) {
        const places = editorPlaces(editor, found.flatMap((b) => [b.start, b.end]));
        const placed = found.map((b, i) => ({ start: b.start, end: b.end, top: places[2 * i].top, bottom: places[2 * i + 1].bottom }));
        editorCache = { value: text, width: editor.clientWidth, key, marks: marksOf(placed, text.length, editor.scrollHeight) };
      }
      return { editor: editorCache.marks, preview: marksOf(found, text.length, preview.scrollHeight) };
    };

    const maxTop = (el: HTMLElement) => el.scrollHeight - el.clientHeight;

    const set = (side: Side, el: HTMLElement, top: number) => {
      const before = el.scrollTop;
      el.scrollTop = top;
      // Only a scroll that moved makes an event to leave alone.
      if (el.scrollTop !== before) expected[side] = el.scrollTop;
    };

    const lead = (from: Side) => {
      const source = from === "editor" ? editor : preview;
      const target = from === "editor" ? preview : editor;
      const both = marks();
      const offset = offsetAtY(both[from], source.scrollTop);
      const matched = yAtOffset(from === "editor" ? both.preview : both.editor, offset);
      set(from === "editor" ? "preview" : "editor", target, follow(matched, maxTop(target), source.scrollTop, maxTop(source)));
    };

    const scrolled = (side: Side) => () => {
      const el = side === "editor" ? editor : preview;
      const mine = expected[side];
      expected[side] = null;
      if (mine !== null && Math.abs(el.scrollTop - mine) < 1) return;
      if (side === "editor") {
        if (!handled("preview")) lead("editor");
      } else if (handled("preview")) {
        lead("preview");
      }
    };

    resync.current = () => {
      if (!handled("preview")) lead("editor");
    };

    const listeners: [HTMLElement, string, EventListener][] = [];
    const on = (el: HTMLElement, type: string, listener: EventListener) => {
      el.addEventListener(type, listener, { passive: true });
      listeners.push([el, type, listener]);
    };
    for (const side of ["editor", "preview"] as const) {
      const el = side === "editor" ? editor : preview;
      on(el, "scroll", scrolled(side));
      for (const type of ["wheel", "touchstart", "touchmove", "pointerdown", "keydown"]) on(el, type, byHand(side));
      // Holding the scrollbar's thumb: by hand for as long as the button is down.
      on(el, "pointermove", (event) => {
        if ((event as PointerEvent).buttons) byHand(side)();
      });
    }
    // Typing in the editor is the editor leading.
    on(editor, "input", byHand("editor"));

    // The preview drawn again, a picture loaded, the pane resized: put the preview back where the editor is.
    // (Where there is no ResizeObserver, as in the tests' jsdom, a change of text still puts it back: the effect below.)
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => resync.current());
    const observeAll = () => {
      if (!observer) return;
      observer.disconnect();
      observer.observe(preview);
      observer.observe(editor);
      for (const child of preview.children) observer.observe(child);
    };
    observeAll();
    const children = new MutationObserver(observeAll);
    children.observe(preview, { childList: true });

    lead("editor");
    return () => {
      for (const [el, type, listener] of listeners) el.removeEventListener(type, listener);
      observer?.disconnect();
      children.disconnect();
      resync.current = () => {};
    };
  }, [enabled, textarea, previewBox]);

  // The text changed: once the preview has drawn it, the editor leads (the caret may have moved the editor too).
  useEffect(() => {
    if (enabled) resync.current();
  }, [enabled, value]);
}
