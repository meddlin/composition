import { describe, expect, it, vi } from "vitest";
import { channelFor, INITIAL_CHANNEL } from "../shared/channels";
import { API_METHODS, type CompositionApi } from "./backend";
import { isTrustedUrl, registerIpc, type IpcEventLike } from "./ipc";

const OWN = "app://composition";

function setup() {
  const handlers = new Map<string, (event: IpcEventLike, ...args: unknown[]) => unknown>();
  const listeners = new Map<string, (event: IpcEventLike) => void>();
  const ipcMain = {
    handle: (channel: string, fn: (event: IpcEventLike, ...args: unknown[]) => unknown) =>
      void handlers.set(channel, fn),
    on: (channel: string, fn: (event: IpcEventLike) => void) => void listeners.set(channel, fn),
  };
  const api = Object.fromEntries(API_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)])) as unknown as {
    [K in keyof CompositionApi]: ReturnType<typeof vi.fn>;
  };
  registerIpc({
    ipcMain,
    api: api as unknown as CompositionApi,
    isTrustedUrl: (url) => isTrustedUrl(url, [OWN]),
    initial: () => ({ theme: "dark" }),
  });
  return { handlers, listeners, api };
}

const own: IpcEventLike = { senderFrame: { url: `${OWN}/settings/` } };

describe("registerIpc", () => {
  it("registers one handler per API method and nothing else", () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(API_METHODS.map(channelFor).sort());
  });

  it("calls the service with validated arguments and returns its result", async () => {
    const { handlers, api } = setup();

    const result = await handlers.get(channelFor("saveNoteContent"))!(own, 7, "hello", "ignored");

    expect(result).toBe("saveNoteContent-result");
    expect(api.saveNoteContent).toHaveBeenCalledWith(7, "hello");
  });

  it("rejects malformed arguments before they reach the service", async () => {
    const { handlers, api } = setup();

    await expect(handlers.get(channelFor("deleteNote"))!(own, "7")).rejects.toThrow(/invalid/);

    expect(api.deleteNote).not.toHaveBeenCalled();
  });

  it.each([
    ["a frame from another origin", { senderFrame: { url: "https://evil.example/" } }],
    ["a lookalike origin", { senderFrame: { url: "app://composition.evil.example/" } }],
    ["a missing frame", { senderFrame: null }],
    ["an unparsable url", { senderFrame: { url: "not a url" } }],
  ])("refuses every method from %s", async (_name, event) => {
    const { handlers, api } = setup();

    for (const method of API_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike)).rejects.toThrow(
        /untrusted sender/,
      );
      expect(api[method]).not.toHaveBeenCalled();
    }
  });

  it("answers the initial-snapshot request only for trusted senders", () => {
    const { listeners } = setup();
    const trusted: IpcEventLike = { ...own };
    const untrusted: IpcEventLike = { senderFrame: { url: "https://evil.example/" } };

    listeners.get(INITIAL_CHANNEL)!(trusted);
    listeners.get(INITIAL_CHANNEL)!(untrusted);

    expect(trusted.returnValue).toEqual({ theme: "dark" });
    expect(untrusted.returnValue).toBeNull();
  });
});

describe("isTrustedUrl", () => {
  it("matches on the exact origin, including port", () => {
    const allowed = [OWN, "http://localhost:3100"];
    expect(isTrustedUrl("app://composition/", allowed)).toBe(true);
    expect(isTrustedUrl("http://localhost:3100/settings/", allowed)).toBe(true);
    expect(isTrustedUrl("http://localhost:3101/", allowed)).toBe(false);
    expect(isTrustedUrl("http://localhost:3100.evil.example/", allowed)).toBe(false);
    expect(isTrustedUrl("file:///etc/passwd", allowed)).toBe(false);
  });
});
