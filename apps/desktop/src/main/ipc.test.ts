import { describe, expect, it, vi } from "vitest";
import { ATTACHMENT_METHODS, type AttachmentsApi } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS, type DesktopBackupApi } from "../../../web/src/lib/composition/backupApi";
import { DOCUMENT_METHODS, type DocumentsApi } from "../../../web/src/lib/composition/documentsApi";
import { ASSISTANT_METHODS } from "../../../web/src/lib/composition/assistantApi";
import { PANELS_METHODS, type PanelsApi } from "../../../web/src/lib/composition/panelsApi";
import { CONTACTS_METHODS, type ContactsApi } from "../../../web/src/lib/composition/contactsApi";
import { FEED_METHODS, type FeedsApi } from "../../../web/src/lib/composition/feedsApi";
import { READING_LIST_METHODS, type ReadingListApi } from "../../../web/src/lib/composition/readingListApi";
import { SAVE_FILE_METHODS, type SaveFileApi } from "../../../web/src/lib/composition/saveFileApi";
import { TODO_METHODS, type TodosApi } from "../../../web/src/lib/composition/todosApi";
import { UPDATE_METHODS, type UpdatesApi } from "../../../web/src/lib/composition/updatesApi";
import { WINDOW_METHODS, type WindowApi } from "../../../web/src/lib/composition/windowApi";
import type { AssistantHost } from "./assistant";
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
  const attachments = Object.fromEntries(
    ATTACHMENT_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof AttachmentsApi]: ReturnType<typeof vi.fn> };
  const documents = Object.fromEntries(
    DOCUMENT_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof DocumentsApi]: ReturnType<typeof vi.fn> };
  const backup = Object.fromEntries(
    BACKUP_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof DesktopBackupApi]: ReturnType<typeof vi.fn> };
  const saveFile = Object.fromEntries(
    SAVE_FILE_METHODS.map((m) => [m, vi.fn(async () => ({ saved: true }))]),
  ) as unknown as { [K in keyof SaveFileApi]: ReturnType<typeof vi.fn> };
  const panels = Object.fromEntries(
    PANELS_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof PanelsApi]: ReturnType<typeof vi.fn> };
  const todos = Object.fromEntries(
    TODO_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof TodosApi]: ReturnType<typeof vi.fn> };
  const readingList = Object.fromEntries(
    READING_LIST_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof ReadingListApi]: ReturnType<typeof vi.fn> };
  const contacts = Object.fromEntries(
    CONTACTS_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  );
  const feeds = Object.fromEntries(
    FEED_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof FeedsApi]: ReturnType<typeof vi.fn> };
  const updates = Object.fromEntries(
    UPDATE_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof UpdatesApi]: ReturnType<typeof vi.fn> };
  const window = Object.fromEntries(
    WINDOW_METHODS.map((m) => [m, vi.fn(async () => `${m}-result`)]),
  ) as unknown as { [K in keyof WindowApi]: ReturnType<typeof vi.fn> };
  const assistant = { chat: vi.fn(async () => {}), abort: vi.fn(async () => {}) } satisfies AssistantHost;
  registerIpc({
    ipcMain,
    assistant,
    api: api as unknown as CompositionApi,
    attachments: attachments as unknown as AttachmentsApi,
    documents: documents as unknown as DocumentsApi,
    backup: backup as unknown as DesktopBackupApi,
    saveFile: saveFile as unknown as SaveFileApi,
    panels: panels as unknown as PanelsApi,
    todos: todos as unknown as TodosApi,
    readingList: readingList as unknown as ReadingListApi,
    contacts: contacts as unknown as ContactsApi,
    feeds: feeds as unknown as FeedsApi,
    updates: updates as unknown as UpdatesApi,
    window: window as unknown as WindowApi,
    isTrustedUrl: (url) => isTrustedUrl(url, [OWN]),
    initial: () => ({ theme: "dark" }),
  });
  return { handlers, listeners, api, attachments, documents, backup, saveFile, panels, todos, readingList, contacts, feeds, updates, window, assistant };
}

const own: IpcEventLike = { senderFrame: { url: `${OWN}/settings/` } };

describe("registerIpc", () => {
  it("registers one handler per API, attachment, PDF, backup, save-file, panels, to-do, Reading List, contacts, feed, update, window and AI helper method, and nothing else", () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(
      [...API_METHODS, ...ATTACHMENT_METHODS, ...DOCUMENT_METHODS, ...BACKUP_METHODS, ...SAVE_FILE_METHODS, ...PANELS_METHODS, ...TODO_METHODS, ...READING_LIST_METHODS, ...CONTACTS_METHODS, ...FEED_METHODS, ...UPDATE_METHODS, ...WINDOW_METHODS, ...ASSISTANT_METHODS].map(channelFor).sort(),
    );
  });

  describe("the AI helper's chat", () => {
    const request = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };
    const sender = { send: vi.fn(), isDestroyed: () => false, once: vi.fn() };
    const ask: IpcEventLike = { senderFrame: { url: `${OWN}/` }, sender };

    it("starts a turn for the window that asked, with the checked request", async () => {
      const { handlers, assistant } = setup();
      await handlers.get(channelFor("assistantChat"))!(ask, "req-1", { ...request, extra: 1 }, "http://evil.example/");
      expect(assistant.chat).toHaveBeenCalledWith(sender, "req-1", request);
    });

    it("stops a turn for the window that asked", async () => {
      const { handlers, assistant } = setup();
      await handlers.get(channelFor("assistantAbort"))!(ask, "req-1");
      expect(assistant.abort).toHaveBeenCalledWith(sender, "req-1");
    });

    it("refuses a frame that is not the app's own, without starting anything", async () => {
      const { handlers, assistant } = setup();
      const stranger: IpcEventLike = { senderFrame: { url: "https://evil.example/" }, sender };
      await expect(handlers.get(channelFor("assistantChat"))!(stranger, "req-1", request)).rejects.toThrow(/untrusted/);
      await expect(handlers.get(channelFor("assistantAbort"))!(stranger, "req-1")).rejects.toThrow(/untrusted/);
      expect(assistant.chat).not.toHaveBeenCalled();
      expect(assistant.abort).not.toHaveBeenCalled();
    });

    it("refuses arguments of the wrong shape, and a cloud model, without starting anything", async () => {
      const { handlers, assistant } = setup();
      const chat = handlers.get(channelFor("assistantChat"))!;
      await expect(chat(ask, "req-1", { ...request, messages: [] })).rejects.toThrow();
      await expect(chat(ask, "req-1", { ...request, model: "gpt-oss:20b:cloud" })).rejects.toThrow();
      await expect(chat(ask, 5, request)).rejects.toThrow();
      expect(assistant.chat).not.toHaveBeenCalled();
    });

    it("refuses a call that has no window to answer to", async () => {
      const { handlers, assistant } = setup();
      await expect(handlers.get(channelFor("assistantChat"))!({ senderFrame: { url: `${OWN}/` } }, "req-1", request)).rejects.toThrow();
      expect(assistant.chat).not.toHaveBeenCalled();
    });
  });

  it("saves the panels the page sends, as sent", async () => {
    const { handlers, panels } = setup();
    const saved = { version: 1, windows: {} };

    await handlers.get(channelFor("savePanels"))!(own, saved);

    expect(panels.savePanels).toHaveBeenCalledWith(saved);
  });

  it("starts a backup or restore without passing on any path the page sends", async () => {
    const { handlers, backup } = setup();

    await handlers.get(channelFor("createBackup"))!(own, "/etc/cron.d/evil");
    await handlers.get(channelFor("restoreBackup"))!(own, "/tmp/whatever.tar.gz");

    expect(backup.createBackup).toHaveBeenCalledWith();
    expect(backup.restoreBackup).toHaveBeenCalledWith();
  });

  it("saves a file with exactly the name, kind and bytes the page sends, and no path", async () => {
    const { handlers, saveFile } = setup();
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4]);

    const result = await handlers.get(channelFor("saveFile"))!(own, { name: "Q3 budget.xlsx", kind: "xlsx", bytes, path: "/etc/cron.d/evil", filePath: "/tmp/x" }, "/tmp/y");

    expect(result).toEqual({ saved: true });
    expect(saveFile.saveFile).toHaveBeenCalledWith({ name: "Q3 budget.xlsx", kind: "xlsx", bytes });
  });

  it("refuses a file of the wrong shape, kind or size without opening a dialog", async () => {
    const { handlers, saveFile } = setup();
    const save = handlers.get(channelFor("saveFile"))!;
    const bytes = new Uint8Array(4);

    await expect(save(own, { name: "a.exe", kind: "exe", bytes })).rejects.toThrow(/invalid/);
    await expect(save(own, { name: "a.xlsx", kind: "xlsx", bytes: "PK" })).rejects.toThrow(/invalid/);
    await expect(save(own, { name: "a.xlsx", kind: "xlsx", bytes: new Uint8Array(0) })).rejects.toThrow(/invalid/);
    await expect(save(own, { name: "a.xlsx", kind: "xlsx", bytes: { length: 4 } })).rejects.toThrow(/invalid/);
    await expect(save(own, "a.xlsx")).rejects.toThrow(/invalid/);
    expect(saveFile.saveFile).not.toHaveBeenCalled();
  });

  it("calls the update methods with a boolean at most, never a url", async () => {
    const { handlers, updates } = setup();

    await handlers.get(channelFor("checkForUpdates"))!(own, "https://evil.example/feed");
    await handlers.get(channelFor("setAutoCheckUpdates"))!(own, false, "https://evil.example/feed");

    expect(updates.checkForUpdates).toHaveBeenCalledWith();
    expect(updates.setAutoCheckUpdates).toHaveBeenCalledWith(false);
    await expect(handlers.get(channelFor("setAutoCheckUpdates"))!(own, "false")).rejects.toThrow(/invalid/);

    await handlers.get(channelFor("setAllowPrerelease"))!(own, true, "https://evil.example/feed");
    expect(updates.setAllowPrerelease).toHaveBeenCalledWith(true);
    await expect(handlers.get(channelFor("setAllowPrerelease"))!(own, "true")).rejects.toThrow(/invalid/);
  });

  it("calls the attachment methods with validated ids, never a path", async () => {
    const { handlers, attachments } = setup();

    const result = await handlers.get(channelFor("addAttachments"))!(own, 7, "/etc/passwd");

    expect(result).toBe("addAttachments-result");
    expect(attachments.addAttachments).toHaveBeenCalledWith(7);
    await expect(handlers.get(channelFor("removeAttachment"))!(own, "3")).rejects.toThrow(/invalid/);
    expect(attachments.removeAttachment).not.toHaveBeenCalled();
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
    const { handlers, api, attachments, backup, saveFile, panels, todos, updates } = setup();

    for (const method of TODO_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike)).rejects.toThrow(/untrusted sender/);
      expect(todos[method]).not.toHaveBeenCalled();
    }
    for (const method of PANELS_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike)).rejects.toThrow(/untrusted sender/);
      expect(panels[method]).not.toHaveBeenCalled();
    }
    for (const method of API_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike)).rejects.toThrow(
        /untrusted sender/,
      );
      expect(api[method]).not.toHaveBeenCalled();
    }
    for (const method of ATTACHMENT_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike)).rejects.toThrow(
        /untrusted sender/,
      );
      expect(attachments[method]).not.toHaveBeenCalled();
    }
    for (const method of BACKUP_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike)).rejects.toThrow(
        /untrusted sender/,
      );
      expect(backup[method]).not.toHaveBeenCalled();
    }
    for (const method of SAVE_FILE_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike, { name: "a.xlsx", kind: "xlsx", bytes: new Uint8Array(1) })).rejects.toThrow(
        /untrusted sender/,
      );
      expect(saveFile[method]).not.toHaveBeenCalled();
    }
    for (const method of UPDATE_METHODS) {
      await expect(handlers.get(channelFor(method))!(event as IpcEventLike)).rejects.toThrow(
        /untrusted sender/,
      );
      expect(updates[method]).not.toHaveBeenCalled();
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
