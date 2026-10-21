"use client";

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { SHORTCUT_GROUPS, type Combo } from "./shortcuts";
import { useIsMac } from "./useIsMac";

const MAC_KEYS: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↵", Tab: "⇥" };
const OTHER_KEYS: Record<string, string> = { Mod: "Ctrl" };

function Keys({ combo, isMac }: { combo: Combo; isMac: boolean }) {
  const glyphs = isMac ? MAC_KEYS : OTHER_KEYS;
  return (
    <span className="inline-flex items-center gap-1">
      {combo.map((key, index) => (
        <Fragment key={key}>
          {index > 0 && !isMac && (
            <span aria-hidden className="text-xs text-muted-foreground">
              +
            </span>
          )}
          <kbd className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs text-foreground">
            {glyphs[key] ?? key}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}

/** Every shortcut, grouped. Shared by the Settings section and the floating helper. */
export function ShortcutList({ className }: { className?: string }) {
  const isMac = useIsMac();
  return (
    <div className={cn("space-y-5", className)}>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</h3>
          <dl className="space-y-1.5">
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.description} className="flex items-start justify-between gap-4">
                <dt className="min-w-0 flex-1">{shortcut.description}</dt>
                <dd className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
                  {shortcut.combos.map((combo, index) => (
                    <Fragment key={combo.join("+")}>
                      {index > 0 && <span className="text-xs text-muted-foreground">or</span>}
                      <Keys combo={combo} isMac={isMac} />
                    </Fragment>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
