"use client";

import { CaseSensitiveIcon, ChevronDownIcon, ChevronUpIcon, WholeWordIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_MATCHES, type FindOptions } from "./findMatches";

type Props = {
  query: string;
  options: FindOptions;
  /** How many matches there are in the note. */
  count: number;
  /** Which of them is being looked at (0-based). */
  current: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onOptionsChange: (options: FindOptions) => void;
  /** Moves to the next (1) or previous (-1) match, wrapping round. */
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
};

/**
 * Find within one note: a phrase typed here is highlighted wherever it occurs in the note's
 * text, and Enter / Shift+Enter walk through the matches. The app-wide search is the bar above
 * the notes; this one only ever looks at the note it sits in.
 */
export function FindBar({ query, options, count, current, inputRef, onQueryChange, onOptionsChange, onStep, onClose }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onStep(event.shiftKey ? -1 : 1);
    }
  }

  const status =
    query === "" ? "" : count === 0 ? "No matches" : `${current + 1} of ${count}${count >= MAX_MATCHES ? "+" : ""}`;

  return (
    <div role="search" aria-label="Find in note" className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in this note…"
        aria-label="Find in note"
        spellCheck={false}
        autoComplete="off"
        className="h-7 min-w-0 flex-1 px-2 md:text-xs"
      />
      <ToggleButton
        label="Match case"
        pressed={options.matchCase}
        onPressedChange={(matchCase) => onOptionsChange({ ...options, matchCase })}
      >
        <CaseSensitiveIcon />
      </ToggleButton>
      <ToggleButton
        label="Whole word"
        pressed={options.wholeWord}
        onPressedChange={(wholeWord) => onOptionsChange({ ...options, wholeWord })}
      >
        <WholeWordIcon />
      </ToggleButton>
      {/* Announced as it changes, so a screen-reader user hears whether the phrase was found. */}
      <span role="status" className="w-20 shrink-0 truncate text-center text-xs tabular-nums text-muted-foreground">
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onStep(-1)}
        disabled={count === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onStep(1)}
        disabled={count === 0}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDownIcon />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close find" title="Close (Esc)">
        <XIcon />
      </Button>
    </div>
  );
}

function ToggleButton({
  label,
  pressed,
  onPressedChange,
  children,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={() => onPressedChange(!pressed)}
      className={cn(pressed ? "bg-accent text-foreground" : "text-muted-foreground")}
    >
      {children}
    </Button>
  );
}
