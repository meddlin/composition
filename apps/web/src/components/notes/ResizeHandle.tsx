"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

const KEY_STEP_PX = 16;

type Props = {
  label: string;
  // Only used for the separator's ARIA value; the parent owns the real state.
  valueNow: number;
  valueMin: number;
  valueMax: number;
  className?: string;
  onResizeStart: () => void;
  /** Distance in px from where the drag (or key press) started. */
  onResize: (dxPx: number) => void;
  onResizeEnd: () => void;
};

/**
 * A draggable vertical divider. It only reports movement, as an offset from
 * where the drag began, so the parent can clamp without the handle drifting
 * away from the cursor once a limit is hit.
 */
export function ResizeHandle({
  label,
  valueNow,
  valueMin,
  valueMax,
  className = "",
  onResizeStart,
  onResize,
  onResizeEnd,
}: Props) {
  const startX = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  // Capture routes moves to the handle, but not every browser keeps the resize
  // cursor while captured, and a drag across the panes would select text.
  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
    setDragging(true);
    onResizeStart();
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (startX.current === null) return;
    onResize(e.clientX - startX.current);
  }

  function endDrag() {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);
    onResizeEnd();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // Restart on every press so held-key repeats keep stepping from the latest size.
    onResizeStart();
    onResize(e.key === "ArrowLeft" ? -KEY_STEP_PX : KEY_STEP_PX);
  }

  function onKeyUp(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") onResizeEnd();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      // The 1px line is the divider; the ::before widens the grab area onto the panes beside it.
      className={cn(
        "relative w-px shrink-0 cursor-col-resize touch-none select-none outline-none transition-colors before:absolute before:inset-y-0 before:-inset-x-1 hover:bg-brand/60 focus-visible:bg-brand",
        dragging ? "bg-brand" : "bg-border",
        className,
      )}
    />
  );
}
