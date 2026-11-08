"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { PdfRect, PdfViewState } from "@/lib/composition/pdfMarkup";
import { pdfOwnTitle } from "@/lib/composition/pdfTitle";
import { loadPdfjs, openPdf, PdfFileError, PdfPasswordError, type OpenedPdf } from "./pdfjs";
import type { PageOnScreen } from "./selectionMarks";

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
  /** Scrolls so that a rectangle of a page (in raw PDF user space) is in view, a little below the top of the panel. */
  goToRect(page: number, rect: PdfRect): void;
  /** The pages pdf.js has drawn into the document now (the others are empty placeholders), with their zoom. */
  pagesOnScreen(): PageOnScreen[];
  /**
   * Calls `listener` whenever pages have been drawn again or zoomed, which is when anything laid over them has to be laid
   * over them again (pdf.js rebuilds a page's contents each time it draws it). Returns the function that stops it.
   */
  onPagesChanged(listener: () => void): () => void;
};

type Options = {
  documentId: number;
  /** Where the reader was last time, and whether dark pages was on. */
  viewState: PdfViewState;
  /** Told how many pages the file has, once known. */
  onPageCount: (pageCount: number) => void;
  /** The password this PDF was opened with earlier in the session, if it has one; tried first so the user is not asked again. */
  password?: string;
  /** Told the password the user typed, once it has opened the PDF (never when the PDF needs none). */
  onPassword?: (password: string) => void;
  /** Told the title the PDF gives itself, when it opens and it has one worth showing (pdfTitle.ts); never told otherwise. */
  onTitle?: (title: string) => void;
  /** Told where the reader is, after it has settled (not at every step of a scroll). */
  onViewState: (state: PdfViewState) => void;
};

export type PdfViewer =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      /** The PDF needs a password to open: the reader asks for it and hands it to `submit`. */
      phase: "password";
      /** The last one given was not right. */
      incorrect: boolean;
      /** A password was given and is being tried. */
      checking: boolean;
      submit: (password: string) => void;
    }
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
      // A protected PDF: the password remembered this session first, then whatever the user types, until it opens. The password
      // goes to pdf.js and to `onPassword` (which keeps it in memory) and nowhere else, and is never written to the console.
      let password = latest.current.password;
      let typed: string | null = null;
      let opened: OpenedPdf | undefined;
      while (!opened) {
        try {
          opened = await openPdf(options.documentId, password);
        } catch (error) {
          if (!(error instanceof PdfPasswordError)) throw error;
          typed = await new Promise<string>((resolve) => {
            if (cancelled) return;
            setState({
              phase: "password",
              incorrect: error.incorrect,
              checking: false,
              submit: (given) => {
                setState({ phase: "password", incorrect: false, checking: true, submit: () => {} });
                resolve(given);
              },
            });
          });
          password = typed;
        }
        if (cancelled) {
          opened?.destroy();
          return;
        }
      }
      if (typed !== null) latest.current.onPassword?.(typed);
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

      const pageListeners = new Set<() => void>();
      const pagesChanged = () => pageListeners.forEach((listener) => listener());

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
        goToRect(target, rect) {
          // The destination is a point of the page: left edge and the top of the rectangle, with a margin above it.
          pdfViewer.scrollPageIntoView({ pageNumber: target, destArray: [null, { name: "XYZ" }, rect[0], rect[3] + 40, null] });
        },
        pagesOnScreen() {
          const found: PageOnScreen[] = [];
          host.querySelectorAll<HTMLElement>(".page[data-page-number]").forEach((element) => {
            const pageNumber = Number(element.dataset.pageNumber);
            const view = pdfViewer.getPageView(pageNumber - 1);
            if (view && element.querySelector(".textLayer")) found.push({ pageNumber, element, viewport: view.viewport });
          });
          return found;
        },
        onPagesChanged(listener) {
          pageListeners.add(listener);
          return () => void pageListeners.delete(listener);
        },
      };
      controlsRef.current = controls;

      // The PDF's own title is for the note to take, if the user has not named it; a file with no usable metadata says nothing.
      void doc
        .getMetadata()
        .then(({ info, metadata }) => {
          const title = pdfOwnTitle({ xmpTitle: metadata?.get("dc:title"), infoTitle: (info as { Title?: unknown } | null)?.Title });
          if (title !== null && !cancelled) latest.current.onTitle?.(title);
        })
        .catch(() => {});

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
      eventBus.on("pagerendered", pagesChanged);
      eventBus.on("textlayerrendered", pagesChanged);
      eventBus.on("scalechanging", () => {
        pagesChanged();
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
