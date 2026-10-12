"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Input } from "@/components/ui/input";
import { searchNotes, type SearchHit, type SearchResult } from "@/lib/composition/client";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "./useDebouncedValue";

export const SEARCH_DEBOUNCE_MS = 350;

// The platform never changes, so there is nothing to subscribe to. The server snapshot is
// null (platform unknown), which keeps hydration consistent before the hint appears.
const subscribeNever = () => () => {};
const clientShortcutHint = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");
const serverShortcutHint = () => null;

type Props = {
  onSelect: (id: number) => void;
};

export function SearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const listboxId = useId();

  const shortcutHint = useSyncExternalStore(subscribeNever, clientShortcutHint, serverShortcutHint);

  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    // Bumping the id first makes any in-flight response for an older query stale.
    const id = ++requestId.current;
    // Empty query needs no request; the dropdown is hidden by `showDropdown`.
    if (debouncedQuery === "") return;
    searchNotes(debouncedQuery).then((next) => {
      if (id !== requestId.current) return;
      setResult(next);
      setHighlighted(0);
    });
  }, [debouncedQuery]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    // Cmd+K on macOS, Ctrl+K elsewhere. Registered on `document` so it works from
    // anywhere in the app, including inside the editor.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault(); // Keep the browser from claiming Ctrl+K (e.g. Firefox's search bar).
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const hits = result?.hits ?? [];

  function choose(hit: SearchHit) {
    onSelect(hit.id);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((h) => (h + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((h) => (h - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      choose(hits[highlighted]);
    }
  }

  const showDropdown = open && query.trim() !== "" && result !== null;

  return (
    <div ref={containerRef} className="relative mx-auto w-full max-w-xl">
      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search notes… or filter: tags: web development"
        aria-label="Search notes"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-keyshortcuts="Control+K Meta+K"
        className="bg-background px-3"
      />
      {shortcutHint && query === "" && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground"
        >
          {shortcutHint}
        </kbd>
      )}
      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-96 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {result.error ? (
            <li className="px-3 py-2 text-sm text-destructive">
              {result.error}
            </li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
          ) : (
            hits.map((hit, i) => (
              <li
                key={hit.id}
                role="option"
                aria-selected={i === highlighted}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => choose(hit)}
                className={cn(
                  "cursor-pointer rounded-md px-3 py-2 text-sm",
                  i === highlighted && "bg-accent text-accent-foreground",
                )}
              >
                <div className="truncate font-medium">
                  {hit.title || "Untitled"}
                </div>
                {hit.description && (
                  <div className="truncate text-xs text-muted-foreground">
                    {hit.description}
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
