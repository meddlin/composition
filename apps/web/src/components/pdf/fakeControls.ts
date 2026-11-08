import { vi } from "vitest";
import type { PdfViewerControls } from "./usePdfViewer";

/** A set of reader controls that are all mocks, for the tests of what is built on them. Test code only. */
export function fakeControls(over: Partial<PdfViewerControls> = {}): PdfViewerControls {
  return {
    goToPage: vi.fn(),
    goToDestination: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitWidth: vi.fn(),
    find: vi.fn(),
    closeFind: vi.fn(),
    goToRect: vi.fn(),
    pagesOnScreen: vi.fn(() => []),
    onPagesChanged: vi.fn(() => () => {}),
    ...over,
  };
}
