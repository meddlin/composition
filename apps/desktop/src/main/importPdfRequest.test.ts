import { describe, expect, it, vi } from "vitest";
import { IMPORT_PDF_CHANNEL } from "../shared/channels";
import { requestImportPdf, type RequestWindow } from "./importPdfRequest";

function windowOf(over: Partial<RequestWindow> = {}) {
  const window = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
    ...over,
  };
  return window;
}

describe("requestImportPdf", () => {
  it("brings the main window forward and tells its page to start the import, with no path in the message", () => {
    const main = windowOf();
    const openMainWindow = vi.fn();

    requestImportPdf({ mainWindow: () => main, openMainWindow });

    expect(main.show).toHaveBeenCalled();
    expect(main.focus).toHaveBeenCalled();
    expect(main.restore).not.toHaveBeenCalled();
    expect(main.webContents.send).toHaveBeenCalledOnce();
    expect(main.webContents.send).toHaveBeenCalledWith(IMPORT_PDF_CHANNEL);
    expect(openMainWindow).not.toHaveBeenCalled();
  });

  it("restores a minimized main window first", () => {
    const main = windowOf({ isMinimized: vi.fn(() => true) });

    requestImportPdf({ mainWindow: () => main, openMainWindow: vi.fn() });

    expect(main.restore).toHaveBeenCalled();
    expect(main.webContents.send).toHaveBeenCalledWith(IMPORT_PDF_CHANNEL);
  });

  it("opens the main window when there is none (the last one was closed on macOS), and starts no import yet", () => {
    const openMainWindow = vi.fn();

    requestImportPdf({ mainWindow: () => null, openMainWindow });

    expect(openMainWindow).toHaveBeenCalledOnce();
  });

  it("treats a destroyed main window as none", () => {
    const gone = windowOf({ isDestroyed: vi.fn(() => true) });
    const openMainWindow = vi.fn();

    requestImportPdf({ mainWindow: () => gone, openMainWindow });

    expect(openMainWindow).toHaveBeenCalledOnce();
    expect(gone.webContents.send).not.toHaveBeenCalled();
    expect(gone.show).not.toHaveBeenCalled();
  });
});
