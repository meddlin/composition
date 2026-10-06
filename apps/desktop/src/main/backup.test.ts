import { describe, expect, it, vi } from "vitest";
import { createBackupApi, type BackupUi } from "./backup";

function setup(ui: Partial<BackupUi> = {}) {
  const service = {
    createBackupAt: vi.fn(async (file: string) => ({ file })),
    restoreBackup: vi.fn(async (file: string) => ({ file })),
  };
  const dialogs: BackupUi = {
    pickSavePath: vi.fn(async () => "/Volumes/usb/mine.tar.gz"),
    pickBackupFile: vi.fn(async () => "/Volumes/usb/mine.tar.gz"),
    ...ui,
  };
  return { service, dialogs, api: createBackupApi(service, dialogs, () => new Date(2026, 9, 2, 15, 30, 45)) };
}

describe("createBackup", () => {
  it("offers a timestamped file name and writes where the save dialog said", async () => {
    const { api, service, dialogs } = setup();

    expect(await api.createBackup()).toEqual({ file: "/Volumes/usb/mine.tar.gz" });

    expect(dialogs.pickSavePath).toHaveBeenCalledWith("composition-backup-2026-10-02-153045.tar.gz");
    expect(service.createBackupAt).toHaveBeenCalledWith("/Volumes/usb/mine.tar.gz");
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { api, service } = setup({ pickSavePath: async () => null });

    expect(await api.createBackup()).toEqual({ canceled: true });
    expect(service.createBackupAt).not.toHaveBeenCalled();
  });
});

describe("restoreBackup", () => {
  it("restores the file the open dialog returned", async () => {
    const { api, service } = setup();

    expect(await api.restoreBackup()).toEqual({ file: "/Volumes/usb/mine.tar.gz" });
    expect(service.restoreBackup).toHaveBeenCalledWith("/Volumes/usb/mine.tar.gz");
  });

  it("does nothing when the dialog is cancelled", async () => {
    const { api, service } = setup({ pickBackupFile: async () => null });

    expect(await api.restoreBackup()).toEqual({ canceled: true });
    expect(service.restoreBackup).not.toHaveBeenCalled();
  });
});
