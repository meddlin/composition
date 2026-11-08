"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PdfViewState } from "@/lib/composition/pdfMarkup";
import { loadPdfjs, openPdf, PdfFileError } from "./pdfjs";

/** What pdf.js's outline calls an entry: a title, where it goes, and the entries under it. */
export type OutlineItem = { title: string; dest: string | unknown[] | null; items: OutlineItem[] };

export type FindProgress = { current: number; total: number; notFound: boolean };

/** The page the reader is on and how it is zoomed, as the reader reports them. */
export type ViewerPosition = { page: number; scale: number };

export type PdfViewerControls = {
  goToPage(page: number): void;
  goToDestination(dest: OutlineItem["dest"]): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  find(query: string, options?: { findPrevious?: boolean }): void;
  closeFind(): void;
};

type Options = {
  documentId: number;
  /** Where the reader was last time, and whether dark pages was on. */
  viewState: PdfViewState;
  /** Told how many pages the file has, once known. */
  onPageCount: (pageCount: number) => void;
  /** Told where the reader is, after it has settled (not at every step of a scroll). */
  onViewState: (state: PdfViewState) => void;
};

export type PdfViewer =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      pageCount: number;
      /** 1-based. */
      page: number;
      /** The printed page labels (a textbook's front matter has roman numerals), when the PDF defines them. */
      labels: string[] | null;
      scale: number;
      outline: OutlineItem[];
      find: FindProgress | null;
      controls: PdfViewerControls;
    };

/** How long the reader sits still before where it is gets saved. */
const SAVE_DELAY_MS = 600;

/**
 * Drives pdf.js's viewer in a scroll container: opens the PDF (range reads, see pdfjs.ts), starts at the page the reader
 * was last on, and reports the page, the zoom, the outline and a find in progress. The container must be absolutely
 * positioned and hold an empty `.pdfViewer` div, which pdf.js fills with pages as they scroll into view.
 */
export function usePdfViewer(container: RefObject<HTMLDivElement | null>, viewerElement: RefObject<HTMLDivElement | null>, options: Options): PdfViewer {
  const [state, setState] = useState<PdfViewer>({ phase: "loading" });
  // The callbacks and the starting state are read when the PDF has opened, not when this effect starts.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const controlsRef = useRef<PdfViewerControls | null>(null);

  useEffect(() => {
    const host = container.current;
    const pages = viewerElement.current;
    if (!host || !pages) return;
    let cancelled = false;
    let teardown: (() => void) | null = null;

    (async () => {
      const { lib, viewer } = await loadPdfjs();
      const opened = await openPdf(options.documentId);
      if (cancelled) {
        opened.destroy();
        return;
      }
      const doc: PDFDocumentProxy = opened.doc;

      const eventBus = new viewer.EventBus();
      const linkService = new viewer.PDFLinkService({ eventBus });
      const findController = new viewer.PDFFindController({ linkService, eventBus });
      const pdfViewer = new viewer.PDFViewer({
        container: host,
        viewer: pages,
        eventBus,
        linkService,
        findController,
        // Selectable text; links drawn but no form widgets or scripts; none of pdf.js's own annotation editors (Composition
        // keeps marks beside the file, never in it).
        textLayerMode: 1,
        annotationMode: lib.AnnotationMode.ENABLE,
        annotationEditorMode: lib.AnnotationEditorType.DISABLE,
        imageResourcesPath: `${location.origin}/pdfjs/images/`,
      });
      linkService.setViewer(pdfViewer);
      pdfViewer.setDocument(doc);
      linkService.setDocument(doc, null);

      let userZoomed = latest.current.viewState.zoom !== undefined;
      let page = 1;
      let saveTimer: ReturnType<typeof setTimeout> | null = null;
      let ready = false;
      let labels: string[] | null = null;
      let outline: OutlineItem[] = [];
      let find: FindProgress | null = null;

      const publish = () => {
        if (cancelled || !ready) return;
        setState({ phase: "ready", pageCount: pdfViewer.pagesCount, page, labels, scale: pdfViewer.currentScale, outline, find, controls });
      };
      const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          const { viewState, onViewState } = latest.current;
          onViewState({ ...viewState, page: page - 1, ...(userZoomed ? { zoom: Math.round(pdfViewer.currentScale * 1000) / 1000 } : {}) });
        }, SAVE_DELAY_MS);
      };

      const controls: PdfViewerControls = {
        goToPage(target) {
          pdfViewer.currentPageNumber = Math.min(Math.max(1, Math.round(target)), pdfViewer.pagesCount);
        },
        goToDestination(dest) {
          if (dest !== null) void linkService.goToDestination(dest as never);
        },
        zoomIn() {
          userZoomed = true;
          pdfViewer.increaseScale();
        },
        zoomOut() {
          userZoomed = true;
          pdfViewer.decreaseScale();
        },
        fitWidth() {
          userZoomed = false;
          pdfViewer.currentScaleValue = "page-width";
        },
        find(query, { findPrevious = false } = {}) {
          eventBus.dispatch("find", { source: controls, type: findPrevious ? "again" : "", query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious, matchDiacritics: false });
        },
        closeFind() {
          eventBus.dispatch("findbarclose", { source: controls });
          find = null;
          publish();
        },
      };
      controlsRef.current = controls;

      eventBus.on("pagesinit", () => {
        const { viewState, onPageCount } = latest.current;
        pdfViewer.currentScaleValue = viewState.zoom !== undefined ? String(viewState.zoom) : "page-width";
        page = Math.min(Math.max(1, (viewState.page ?? 0) + 1), pdfViewer.pagesCount);
        pdfViewer.currentPageNumber = page;
        ready = true;
        onPageCount(pdfViewer.pagesCount);
        publish();
        void doc.getPageLabels().then((found) => {
          labels = found;
          publish();
        }).catch(() => {});
        void doc.getOutline().then((found) => {
          outline = (found ?? []) as OutlineItem[];
          publish();
        }).catch(() => {});
      });
      eventBus.on("pagechanging", (event: { pageNumber: number }) => {
        page = event.pageNumber;
        publish();
        if (ready) scheduleSave();
      });
      eventBus.on("scalechanging", () => {
        publish();
        if (ready && userZoomed) scheduleSave();
      });
      const onMatches = (event: { matchesCount: { current: number; total: number } }) => {
        find = { ...event.matchesCount, notFound: event.matchesCount.total === 0 };
        publish();
      };
      eventBus.on("updatefindmatchescount", onMatches);
      eventBus.on("updatefindcontrolstate", (event: { matchesCount: { current: number; total: number }; state: number }) => {
        // `state` 1 is "not found"; the count alone cannot tell "nothing yet" from "nothing".
        find = { ...event.matchesCount, notFound: event.state === 1 };
        publish();
      });

      teardown = () => {
        if (saveTimer) {
          clearTimeout(saveTimer);
          // Where the reader was is worth keeping: leaving the panel is the usual way to stop reading.
          const { viewState, onViewState } = latest.current;
          onViewState({ ...viewState, page: page - 1, ...(userZoomed ? { zoom: Math.round(pdfViewer.currentScale * 1000) / 1000 } : {}) });
        }
        controlsRef.current = null;
        pdfViewer.setDocument(null as never);
        opened.destroy();
      };
    })().catch((error: unknown) => {
      // The reader shows a sentence; what went wrong underneath is for whoever is looking at the console.
      console.error("[pdf] could not be opened:", error);
      if (!cancelled) setState({ phase: "error", message: error instanceof PdfFileError ? error.message : "The PDF could not be opened." });
    });

    return () => {
      cancelled = true;
      teardown?.();
    };
    // Only a different PDF starts again; the rest is read from `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.documentId]);

  return state;
}
