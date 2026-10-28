import { ATTACHMENT_METHODS, type AttachmentsApi } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS, type DesktopBackupApi } from "../../../web/src/lib/composition/backupApi";
import { PANELS_METHODS, type PanelsApi } from "../../../web/src/lib/composition/panelsApi";
import { ASSISTANT_METHODS } from "../../../web/src/lib/composition/assistantApi";
import { UPDATE_METHODS, type UpdatesApi } from "../../../web/src/lib/composition/updatesApi";
import { WINDOW_METHODS, type WindowApi } from "../../../web/src/lib/composition/windowApi";
import { channelFor, INITIAL_CHANNEL } from "../shared/channels";
import type { AssistantHost, AssistantSender } from "./assistant";
import { API_METHODS, type CompositionApi } from "./backend";
import { isAllowedOrigin } from "./origin";
import { ASSISTANT_VALIDATORS, ATTACHMENT_VALIDATORS, BACKUP_VALIDATORS, PANELS_VALIDATORS, UPDATE_VALIDATORS, VALIDATORS, WINDOW_VALIDATORS } from "./validate";

/** The slice of Electron's `ipcMain` this module uses, so tests don't need Electron. */
export type IpcMainLike = {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void): void;
};

export type IpcEventLike = {
  senderFrame?: { url: string } | null;
  /** The window's web contents; the AI helper's events are pushed back to it and to no other window. */
  sender?: AssistantSender;
  returnValue?: unknown;
};

export class UntrustedSenderError extends Error {}

/**
 * Exposes the whole CompositionApi, and the desktop-only AttachmentsApi,
 * DesktopBackupApi, PanelsApi, UpdatesApi, WindowApi and AI helper chat calls, over IPC, one channel per method.
 *
 * Every call is checked twice: the sender must be a frame of our own UI (a
 * navigated-away or injected frame must never reach the notes database), and
 * the arguments must have the right shape.
 */
export function registerIpc(options: {
  ipcMain: IpcMainLike;
  api: CompositionApi;
  attachments: AttachmentsApi;
  backup: DesktopBackupApi;
  panels: PanelsApi;
  updates: UpdatesApi;
  window: WindowApi;
  /** Runs the AI helper's chat turns. Not a plain method: it needs the window that asked. */
  assistant: AssistantHost;
  isTrustedUrl: (url: string) => boolean;
  /** Synchronous snapshot for the preload, taken before the page paints. */
  initial: () => unknown;
}): void {
  const { ipcMain, api, attachments, backup, panels, updates, window, assistant, isTrustedUrl, initial } = options;

  const trusted = (event: IpcEventLike): boolean => {
    const url = event.senderFrame?.url;
    return typeof url === "string" && isTrustedUrl(url);
  };

  const expose = (
    method: string,
    validate: (args: unknown[]) => unknown[],
    target: object,
  ) => {
    ipcMain.handle(channelFor(method), async (event, ...args) => {
      if (!trusted(event)) throw new UntrustedSenderError(`${method}: untrusted sender`);
      const validated = validate(args);
      const call = (target as Record<string, (...callArgs: unknown[]) => Promise<unknown>>)[method];
      return call.apply(target, validated);
    });
  };

  for (const method of API_METHODS) expose(method, VALIDATORS[method], api);
  for (const method of ATTACHMENT_METHODS) expose(method, ATTACHMENT_VALIDATORS[method], attachments);
  for (const method of BACKUP_METHODS) expose(method, BACKUP_VALIDATORS[method], backup);
  for (const method of PANELS_METHODS) expose(method, PANELS_VALIDATORS[method], panels);
  for (const method of UPDATE_METHODS) expose(method, UPDATE_VALIDATORS[method], updates);
  for (const method of WINDOW_METHODS) expose(method, WINDOW_VALIDATORS[method], window);

  // The AI helper's calls need the window that asked (`event.sender`), which `expose` does not pass on.
  const assistantCall = (
    method: (typeof ASSISTANT_METHODS)[number],
    validate: (args: unknown[]) => unknown[],
    run: (sender: AssistantSender, args: unknown[]) => Promise<void>,
  ) =>
    ipcMain.handle(channelFor(method), async (event, ...args) => {
      if (!trusted(event)) throw new UntrustedSenderError(`${method}: untrusted sender`);
      const validated = validate(args);
      if (!event.sender) throw new UntrustedSenderError(`${method}: no window to answer to`);
      await run(event.sender, validated);
    });
  assistantCall("assistantChat", ASSISTANT_VALIDATORS.assistantChat, (sender, [requestId, request]) =>
    assistant.chat(sender, requestId as string, request as Parameters<AssistantHost["chat"]>[2]),
  );
  assistantCall("assistantAbort", ASSISTANT_VALIDATORS.assistantAbort, (sender, [requestId]) => assistant.abort(sender, requestId as string));

  ipcMain.on(INITIAL_CHANNEL, (event) => {
    event.returnValue = trusted(event) ? initial() : null;
  });
}

/** Whether `url` belongs to one of the allowed origins (exact origin match, not a prefix). */
export function isTrustedUrl(url: string, allowedOrigins: readonly string[]): boolean {
  return isAllowedOrigin(url, allowedOrigins);
}
