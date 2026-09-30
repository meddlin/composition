import { channelFor, INITIAL_CHANNEL } from "../shared/channels";
import { API_METHODS, type CompositionApi } from "./backend";
import { isAllowedOrigin } from "./origin";
import { VALIDATORS } from "./validate";

/** The slice of Electron's `ipcMain` this module uses, so tests don't need Electron. */
export type IpcMainLike = {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void;
};

export type IpcEventLike = {
  senderFrame?: { url: string } | null;
  returnValue?: unknown;
};

export class UntrustedSenderError extends Error {}

/**
 * Exposes the whole CompositionApi over IPC, one channel per method.
 *
 * Every call is checked twice: the sender must be a frame of our own UI (a
 * navigated-away or injected frame must never reach the notes database), and
 * the arguments must have the right shape.
 */
export function registerIpc(options: {
  ipcMain: IpcMainLike;
  api: CompositionApi;
  isTrustedUrl: (url: string) => boolean;
  /** Synchronous snapshot for the preload, taken before the page paints. */
  initial: () => unknown;
}): void {
  const { ipcMain, api, isTrustedUrl, initial } = options;

  const trusted = (event: IpcEventLike): boolean => {
    const url = event.senderFrame?.url;
    return typeof url === "string" && isTrustedUrl(url);
  };

  for (const method of API_METHODS) {
    ipcMain.handle(channelFor(method), async (event, ...args) => {
      if (!trusted(event)) throw new UntrustedSenderError(`${method}: untrusted sender`);
      const validated = VALIDATORS[method](args);
      const call = api[method] as (...callArgs: unknown[]) => Promise<unknown>;
      return call.apply(api, validated);
    });
  }

  ipcMain.on(INITIAL_CHANNEL, (event) => {
    event.returnValue = trusted(event) ? initial() : null;
  });
}

/** Whether `url` belongs to one of the allowed origins (exact origin match, not a prefix). */
export function isTrustedUrl(url: string, allowedOrigins: readonly string[]): boolean {
  return isAllowedOrigin(url, allowedOrigins);
}
