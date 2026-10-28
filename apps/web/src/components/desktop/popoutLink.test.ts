// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { forgetPopoutsTheUserCloses, openPopoutWindow, popoutUrl, publishWorkspace, sharedWorkspaceFromOpener } from "./popoutLink";

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__workspace;
  Object.defineProperty(window, "opener", { value: null, configurable: true });
});

const shared = { store: {} as WorkspaceStore, writing: { ruler: false, reflow: false } } as unknown as NonNullable<typeof window.__workspace>;

describe("the link between a pop-out and the main window", () => {
  it("publishes the workspace on the main window, for the pages it opens to find", () => {
    publishWorkspace(shared);

    expect(window.__workspace).toBe(shared);
  });

  it("finds the workspace the window that opened it published", () => {
    Object.defineProperty(window, "opener", { value: { __workspace: shared }, configurable: true });

    expect(sharedWorkspaceFromOpener()).toBe(shared);
  });

  it("finds none when it was not opened by a window, or the opener published nothing", () => {
    expect(sharedWorkspaceFromOpener()).toBeNull();

    Object.defineProperty(window, "opener", { value: {}, configurable: true });
    expect(sharedWorkspaceFromOpener()).toBeNull();
  });

  it("finds none when the opener cannot be read (another origin)", () => {
    Object.defineProperty(window, "opener", {
      get() {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
      configurable: true,
    });

    expect(sharedWorkspaceFromOpener()).toBeNull();
  });

  it("builds the address of a pop-out's page from the origin the app is served from", () => {
    expect(popoutUrl("w2")).toBe(`${window.location.origin}/popout/?w=w2`);
  });

  it("opens the pop-out's page in a window named for it, so the same window is never opened twice", () => {
    const opened = { closed: false, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);

    expect(openPopoutWindow("w2")).toBe(opened);
    expect(open).toHaveBeenCalledWith(popoutUrl("w2"), "composition-w2");
  });

  it("reports a window that could not be opened as none", () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    expect(openPopoutWindow("w2")).toBeNull();
  });

  describe("forgetPopoutsTheUserCloses", () => {
    afterEach(() => {
      delete (window as unknown as { composition?: unknown }).composition;
    });

    it("takes a window out of the workspace when the app says the user closed it, and stops when told to", () => {
      const listeners = new Set<(windowId: string) => void>();
      (window as unknown as { composition: unknown }).composition = {
        onPopoutClosed: (listener: (windowId: string) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      const store = { closeWindow: vi.fn() } as unknown as WorkspaceStore;

      const stop = forgetPopoutsTheUserCloses(store);
      listeners.forEach((listener) => listener("w2"));
      expect(store.closeWindow).toHaveBeenCalledWith("w2");

      stop();
      expect(listeners.size).toBe(0);
    });

    it("does nothing outside the desktop app", () => {
      const stop = forgetPopoutsTheUserCloses({ closeWindow: vi.fn() } as unknown as WorkspaceStore);

      expect(() => stop()).not.toThrow();
    });
  });
});
