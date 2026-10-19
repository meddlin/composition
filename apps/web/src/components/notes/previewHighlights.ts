// The CSS Custom Highlight API paints ranges of existing text without touching the DOM, which is
// what lets React keep owning the preview. The highlights are named and global to the document, so
// panes that are searching at once each hand in their ranges and the lot is painted together.
// Where the API is missing the preview simply goes unpainted; matches are still counted.

export const MATCH_HIGHLIGHT = "find-match";
export const CURRENT_HIGHLIGHT = "find-current";

type Painted = { matches: Range[]; current: Range | null };

const owners = new Map<symbol, Painted>();

type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): void };
type HighlightConstructor = new (...ranges: Range[]) => unknown;

function api(): { registry: HighlightRegistry; Highlight: HighlightConstructor } | null {
  const registry = (globalThis.CSS as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

function paint() {
  const available = api();
  if (!available) return;
  const { registry, Highlight } = available;
  const matches = [...owners.values()].flatMap((p) => p.matches);
  const current = [...owners.values()].flatMap((p) => (p.current ? [p.current] : []));
  if (matches.length > 0) registry.set(MATCH_HIGHLIGHT, new Highlight(...matches));
  else registry.delete(MATCH_HIGHLIGHT);
  if (current.length > 0) registry.set(CURRENT_HIGHLIGHT, new Highlight(...current));
  else registry.delete(CURRENT_HIGHLIGHT);
}

/** Paints `matches` for `owner`, and `current` (one of them) in the stronger colour. */
export function setPreviewHighlights(owner: symbol, matches: Range[], current: Range | null) {
  owners.set(owner, { matches, current });
  paint();
}

export function clearPreviewHighlights(owner: symbol) {
  if (owners.delete(owner)) paint();
}
