"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { READING_LIST_PARTITION } from "@/lib/composition/readingListApi";
import type { WebviewHandle, WebviewProps, WebviewState } from "./webviewSeam";

/** The part of Electron's `<webview>` element the panel uses. */
type WebviewElement = HTMLElement & {
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
};

type NavigateEvent = Event & { url?: string };
type TitleEvent = Event & { title?: string };
type FailEvent = Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };

/** Chromium's "the load was cancelled" (a click on another link while one loads); not a failure to show. */
const ERR_ABORTED = -3;

/**
 * Whether something that would stall on top of a web view is going on: a divider or a panel being dragged. A `<webview>`
 * swallows pointer and drag events, as an iframe does, so while this is true the view lets them through.
 */
function useUiDragging(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const on = () => setDragging(true);
    const off = () => setDragging(false);
    window.addEventListener("dragstart", on, true);
    window.addEventListener("dragend", off, true);
    window.addEventListener("drop", off, true);
    // ResizeHandle marks the body while a divider is held (see ResizeHandle.tsx).
    const watch = new MutationObserver(() => setDragging(document.body.hasAttribute("data-resizing")));
    watch.observe(document.body, { attributes: true, attributeFilter: ["data-resizing"] });
    return () => {
      window.removeEventListener("dragstart", on, true);
      window.removeEventListener("dragend", off, true);
      window.removeEventListener("drop", off, true);
      watch.disconnect();
    };
  }, []);
  return dragging;
}

/**
 * Shows a page in Electron's `<webview>`, in the Reading List's own partition (the main process forces that, and the
 * isolation, whatever is asked here; see readingListGuard.ts). The element is made by hand rather than in JSX: the
 * `partition` has to be set before `src`, and React has no type for the tag.
 */
export function ReadingWebview({ src, onChange, handle }: WebviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<WebviewElement | null>(null);
  const ready = useRef(false);
  const dragging = useUiDragging();
  // Held in a ref so the events keep reporting to the latest panel without remaking the view.
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });

  useImperativeHandle(handle, (): WebviewHandle => ({
    back: () => ready.current && view.current?.goBack(),
    forward: () => ready.current && view.current?.goForward(),
    reload: () => ready.current && view.current?.reload(),
  }));

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const element = document.createElement("webview") as WebviewElement;
    view.current = element;
    ready.current = false;
    element.className = "absolute inset-0 size-full";

    const nav = (): Partial<WebviewState> => {
      if (!ready.current) return {};
      try {
        return { canGoBack: element.canGoBack(), canGoForward: element.canGoForward() };
      } catch {
        return {};
      }
    };
    const on = (type: string, listener: (event: never) => void) => element.addEventListener(type, listener as EventListener);
    on("dom-ready", () => {
      ready.current = true;
      report.current(nav());
    });
    on("did-start-loading", () => report.current({ loading: true, failure: null }));
    on("did-stop-loading", () => report.current({ loading: false, ...nav() }));
    on("did-navigate", (event: NavigateEvent) => report.current({ ...(event.url ? { url: event.url } : {}), ...nav() }));
    on("did-navigate-in-page", (event: NavigateEvent) => report.current({ ...(event.url ? { url: event.url } : {}), ...nav() }));
    on("page-title-updated", (event: TitleEvent) => report.current({ title: event.title ?? null }));
    on("did-fail-load", (event: FailEvent) => {
      if (event.isMainFrame === false || event.errorCode === ERR_ABORTED) return;
      report.current({ loading: false, failure: event.errorDescription || "The page could not be loaded." });
    });
    on("render-process-gone", () => report.current({ loading: false, failure: "The page stopped working." }));

    // The partition is read when the view first loads, so it goes before `src`.
    element.setAttribute("partition", READING_LIST_PARTITION);
    // Without this Electron drops a new-window request before the main process hears of it; the guest's open handler
    // (readingListGuard.ts) then refuses every window and sends the address to the user's browser instead.
    element.setAttribute("allowpopups", "");
    element.setAttribute("src", src);
    container.appendChild(element);
    return () => {
      element.remove();
      if (view.current === element) view.current = null;
    };
    // The panel makes a new view (a `key`) for each link, so `src` is only ever the starting address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="relative min-h-0 min-w-0 flex-1" style={dragging ? { pointerEvents: "none" } : undefined} />;
}
