// What shapes text layout in a textarea; copied onto the mirror so it wraps identically.
const LAYOUT_PROPERTIES = [
  "box-sizing",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
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

/**
 * Where the character at `position` sits inside the textarea's box, ignoring
 * its scroll. A textarea can't report this, so the text before `position` is
 * laid out in an invisible copy of it and a marker's offset is read off.
 */
export function caretCoordinates(el: HTMLTextAreaElement, position: number): { top: number; left: number; height: number } {
  const computed = getComputedStyle(el);
  const mirror = document.createElement("div");
  const { style } = mirror;
  for (const property of LAYOUT_PROPERTIES) style.setProperty(property, computed.getPropertyValue(property));
  // The textarea's scrollbar takes width from its text, so size the mirror to the text area, not the whole box.
  style.width = `${el.clientWidth + parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth)}px`;
  style.position = "absolute";
  style.visibility = "hidden";
  style.overflow = "hidden";
  style.whiteSpace = "pre-wrap";
  style.overflowWrap = "break-word";

  mirror.textContent = el.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(position, position + 1) || ".";
  mirror.append(marker);

  document.body.append(mirror);
  const coordinates = {
    top: marker.offsetTop + parseFloat(computed.borderTopWidth),
    left: marker.offsetLeft + parseFloat(computed.borderLeftWidth),
    // `normal` has no pixel value; fall back to the marker's own height.
    height: parseFloat(computed.lineHeight) || marker.offsetHeight,
  };
  mirror.remove();
  return coordinates;
}
