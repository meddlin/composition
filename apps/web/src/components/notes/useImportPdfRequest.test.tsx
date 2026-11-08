// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "@/lib/composition/desktopBridge";
import { useImportPdfRequest } from "./useImportPdfRequest";

afterEach(() => {
  cleanup();
  delete window.composition;
});

/** A bridge that remembers who listens for the menu's request, so a test can make the menu ask. */
function bridge() {
  const listeners = new Set<() => void>();
  window.composition = { onImportPdfRequest: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)) } as unknown as DesktopBridge;
  return { ask: () => listeners.forEach((listener) => listener()), listening: () => listeners.size };
}

function Harness({ onRequest }: { onRequest: (() => void) | undefined }) {
  useImportPdfRequest(onRequest);
  return null;
}

describe("useImportPdfRequest", () => {
  it("runs the callback each time the menu asks", () => {
    const menu = bridge();
    const onRequest = vi.fn();
    render(<Harness onRequest={onRequest} />);

    menu.ask();
    menu.ask();

    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  it("calls the latest callback, without listening again when it changes", () => {
    const menu = bridge();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness onRequest={first} />);

    rerender(<Harness onRequest={second} />);
    menu.ask();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(menu.listening()).toBe(1);
  });

  it("does nothing where there is no callback (no PDFs), and stops listening when the window goes", () => {
    const menu = bridge();
    const { rerender, unmount } = render(<Harness onRequest={undefined} />);

    expect(() => menu.ask()).not.toThrow();
    rerender(<Harness onRequest={vi.fn()} />);
    unmount();

    expect(menu.listening()).toBe(0);
  });

  it("is a no-op in the web app, which has no bridge", () => {
    expect(() => render(<Harness onRequest={vi.fn()} />)).not.toThrow();
  });
});
