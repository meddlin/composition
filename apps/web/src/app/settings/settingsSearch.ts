/**
 * Search for the Settings screen.
 *
 * The screen is a dozen independent sections, some of which only exist on the desktop (or only on macOS), so a
 * hand-kept list of settings would drift from it. This reads what is rendered instead: each page is cut into the
 * groups a person scans for (a card, or a fieldset such as "Color scheme"), and a group matches when its text does.
 */

export type SettingsSearchPage = {
  id: string;
  label: string;
  /** The page's rendered panel. Panels stay mounted while hidden, so every page can be searched. */
  root: HTMLElement;
};

export type SettingsHit = {
  pageId: string;
  pageLabel: string;
  /** The group's own heading, or the page's name when the group has none. */
  title: string;
  element: HTMLElement;
};

const GROUP = '[data-slot="card"], [data-slot="field-set"]';
const HEADING = '[data-slot="card-title"], legend, label';

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What the element says, as words. Not `textContent`, which runs neighbouring elements together
 * ("Color scheme" + "Dark" becomes "Color schemeDark") so that the second word could not be found by its start.
 */
function textOf(element: Element): string {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue ?? "");
  return squash(parts.join(" "));
}

/** The outermost groups of a page, in page order. Settings outside any group (a bare form) count as one. */
function groupsIn(root: HTMLElement): HTMLElement[] {
  const groups = [...root.querySelectorAll<HTMLElement>(GROUP)].filter((group) => !group.parentElement?.closest(GROUP));
  const forms = [...root.querySelectorAll<HTMLElement>("form")].filter(
    (form) => !form.closest(GROUP) && !form.querySelector(GROUP),
  );
  return [...groups, ...forms].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * The groups whose text, or whose page's name, has every word of the query, each word matching from the start of a
 * word ("sun" finds "Follow the sun", "un" does not). Groups whose own heading matches come first.
 */
export function searchSettings(pages: SettingsSearchPage[], query: string): SettingsHit[] {
  const words = squash(query).toLowerCase().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const patterns = words.map((word) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}`, "u"));
  const matches = (text: string) => patterns.every((pattern) => pattern.test(text));

  const byHeading: SettingsHit[] = [];
  const byBody: SettingsHit[] = [];
  for (const { id, label, root } of pages) {
    for (const element of groupsIn(root)) {
      const headingElement = element.querySelector(HEADING);
      const heading = headingElement ? textOf(headingElement) : "";
      const hit = { pageId: id, pageLabel: label, title: heading || label, element };
      if (matches(heading.toLowerCase())) byHeading.push(hit);
      else if (matches(`${textOf(element)} ${label}`.toLowerCase())) byBody.push(hit);
    }
  }
  return [...byHeading, ...byBody];
}

/** Scrolls a found group into view and rings it for a moment, so it is clear which one the search meant. */
export function revealSetting(element: HTMLElement) {
  if (!element.isConnected) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  element.style.scrollMarginTop = "1.5rem";
  element.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  element.animate?.(
    [
      { outline: "2px solid var(--ring)", outlineOffset: "4px" },
      { outline: "2px solid transparent", outlineOffset: "4px" },
    ],
    { duration: 1600, easing: "ease-out" },
  );
}
