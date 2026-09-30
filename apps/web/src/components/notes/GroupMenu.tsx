"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  groupName: string;
  /** Delete is only offered for a group with no sub-groups or notes. */
  canDelete: boolean;
  onRename: () => void;
  onCreateSubgroup: () => void;
  onDelete: () => void;
};

// Rough rendered height, used only to decide whether to open upward.
const MENU_HEIGHT = 120;

/**
 * The "⋯" button on a group row and the menu it opens. The menu is positioned
 * with `fixed` so the sidebar's scroll container can't clip it.
 */
export function GroupMenu({ groupName, canDelete, onRename, onCreateSubgroup, onDelete }: Props) {
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = position !== null;

  function toggle() {
    if (open) {
      setPosition(null);
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const opensUp = rect.bottom + MENU_HEIGHT > window.innerHeight && rect.top > MENU_HEIGHT;
    setPosition({
      top: opensUp ? rect.top - MENU_HEIGHT : rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }

  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setPosition(null);
    }
    const dismiss = () => setPosition(null);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", dismiss);
    // Capture: the sidebar scrolls its own container, which doesn't bubble.
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(
        menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      close();
    }
  }

  function choose(action: () => void) {
    close();
    action();
  }

  const itemClass =
    "block w-full px-3 py-1.5 text-left text-sm hover:bg-foreground/10 focus:bg-foreground/10 focus:outline-none disabled:pointer-events-none disabled:opacity-40";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={toggle}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={`Actions for ${groupName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className={`rounded px-1.5 py-0.5 text-xs hover:bg-foreground/10 hover:opacity-100 focus-visible:opacity-100 ${
          open ? "opacity-100" : "opacity-60"
        }`}
      >
        ⋯
      </button>
      {position && (
        <div
          ref={menu}
          role="menu"
          aria-label={`${groupName} actions`}
          onKeyDown={onMenuKeyDown}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{ top: position.top, right: position.right }}
          className="fixed z-50 min-w-40 overflow-hidden rounded-md border border-foreground/15 bg-surface py-1 shadow-lg"
        >
          <button type="button" role="menuitem" className={itemClass} onClick={() => choose(onRename)}>
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => choose(onCreateSubgroup)}
          >
            New sub-group
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canDelete}
            title={canDelete ? undefined : "Empty this group before deleting"}
            className={`${itemClass} text-error`}
            onClick={() => choose(onDelete)}
          >
            Delete group
          </button>
        </div>
      )}
    </>
  );
}
