"use client";

import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { PaneView } from "./panes";

const TABS: { view: PaneView; label: string }[] = [
  { view: "markdown", label: "Markdown" },
  { view: "preview", label: "Preview" },
  { view: "split", label: "Split" },
];

/** What each tab brings into view: split shows both of the others' panels. */
export const tabId = (idBase: string, view: PaneView) => `${idBase}-tab-${view}`;
export const panelId = (idBase: string, view: PaneView) => `${idBase}-panel-${view}`;

type Props = {
  /** Shared with the editor, whose panels these tabs control. */
  idBase: string;
  view: PaneView;
  /** Whether there is room for the editor and preview beside each other. */
  canSplit: boolean;
  onChange: (view: PaneView) => void;
};

/**
 * Switches a note between its editor, its preview, and both side by side.
 * Arrow keys move between the tabs (and select, as there is nothing to load).
 */
export function EditorTabs({ idBase, view, canSplit, onChange }: Props) {
  const tabs = canSplit ? TABS : TABS.filter((tab) => tab.view !== "split");

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.view === view);
    const next = {
      ArrowRight: (current + 1) % tabs.length,
      ArrowLeft: (current - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange(tabs[next].view);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="View" onKeyDown={onKeyDown} className="flex shrink-0 border-b px-2">
      {tabs.map((tab) => {
        const selected = tab.view === view;
        return (
          <button
            key={tab.view}
            type="button"
            role="tab"
            id={tabId(idBase, tab.view)}
            aria-selected={selected}
            aria-controls={
              tab.view === "split"
                ? `${panelId(idBase, "markdown")} ${panelId(idBase, "preview")}`
                : panelId(idBase, tab.view)
            }
            // Only the selected tab is in the tab order; the arrow keys reach the rest.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.view)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-xs font-medium uppercase tracking-wide outline-none transition-colors focus-visible:text-foreground focus-visible:underline",
              selected
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
