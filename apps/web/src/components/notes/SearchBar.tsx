"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchNotes, type SearchHit, type SearchResult } from "@/lib/composition/actions";
import { useDebouncedValue } from "./useDebouncedValue";

export const SEARCH_DEBOUNCE_MS = 350;

type Props = {
  onSelect: (id: number) => void;
};

export function SearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const listboxId = useId();

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
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search notes…"
        aria-label="Search notes"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className="w-full rounded-md border border-foreground/15 bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none"
      />
      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-96 overflow-y-auto rounded-md border border-foreground/10 bg-background py-1 shadow-lg"
        >
          {result.error ? (
            <li className="px-3 py-2 text-sm text-error">
              {result.error}
            </li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2 text-sm text-foreground/60">No matches</li>
          ) : (
            hits.map((hit, i) => (
              <li
                key={hit.id}
                role="option"
                aria-selected={i === highlighted}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => choose(hit)}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  i === highlighted ? "bg-foreground/6" : ""
                }`}
              >
                <div className="truncate font-medium text-foreground">
                  {hit.title || "Untitled"}
                </div>
                {hit.description && (
                  <div className="truncate text-xs text-foreground/60">
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
