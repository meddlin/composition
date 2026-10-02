// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup, restoreBackup } from "@/lib/composition/backupClient";
import { BackupRestore } from "./BackupRestore";

vi.mock("@/lib/composition/backupClient", () => ({
  BACKUP_NEEDS_PATH: true,
  createBackup: vi.fn(),
  restoreBackup: vi.fn(),
}));

const counts = { notes: 12, groups: 3, trashedNotes: 0, trashedGroups: 0, images: 4, attachments: 1 };
const reload = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderIt() {
  render(<BackupRestore defaultBackupDir="/home/me/Composition Backups" />);
}

describe("Backup", () => {
  it("offers the default folder and creates a backup there, then says what it holds", async () => {
    vi.mocked(createBackup).mockResolvedValue({ file: "/home/me/Composition Backups/composition-backup-1.tar.gz", bytes: 1_400_000, counts });
    renderIt();

    expect((screen.getByLabelText("Backup folder") as HTMLInputElement).value).toBe("/home/me/Composition Backups");
    fireEvent.click(screen.getByRole("button", { name: "Create backup" }));

    const status = await screen.findByRole("status");
    expect(createBackup).toHaveBeenCalledWith("/home/me/Composition Backups");
    expect(status.textContent).toBe(
      "Backed up 12 notes, 3 groups, 4 images and 1 attached file to /home/me/Composition Backups/composition-backup-1.tar.gz (1.4 MB).",
    );
  });

  it("uses the folder that was typed", async () => {
    vi.mocked(createBackup).mockResolvedValue({ file: "/x/b.tar.gz", counts });
    renderIt();

    fireEvent.change(screen.getByLabelText("Backup folder"), { target: { value: "/Volumes/usb" } });
    fireEvent.click(screen.getByRole("button", { name: "Create backup" }));

    await screen.findByRole("status");
    expect(createBackup).toHaveBeenCalledWith("/Volumes/usb");
  });

  it("shows a failure instead of success", async () => {
    vi.mocked(createBackup).mockResolvedValue({ error: "Permission denied" });
    renderIt();

    fireEvent.click(screen.getByRole("button", { name: "Create backup" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Permission denied");
  });

  it("cannot be pressed with no folder", () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Backup folder"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Create backup" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Restore", () => {
  it("cannot be started without a file", () => {
    renderIt();
    expect((screen.getByRole("button", { name: "Restore…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks before replacing everything, and does nothing if cancelled", async () => {
    renderIt();
    fireEvent.change(screen.getByLabelText("Backup file"), { target: { value: "/b.tar.gz" } });

    fireEvent.click(screen.getByRole("button", { name: "Restore…" }));
    expect(await screen.findByText("Replace everything with a backup?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Replace everything with a backup?")).toBeNull());
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it("restores once confirmed, then reloads the page and remembers what it did", async () => {
    vi.mocked(restoreBackup).mockResolvedValue({ file: "/b.tar.gz", counts, safetyBackup: "/home/me/Composition Backups/pre.tar.gz" });
    renderIt();
    fireEvent.change(screen.getByLabelText("Backup file"), { target: { value: "/b.tar.gz" } });

    fireEvent.click(screen.getByRole("button", { name: "Restore…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(restoreBackup).toHaveBeenCalledWith("/b.tar.gz");
    expect(sessionStorage.getItem("composition:backup-restored")).toContain("Restored 12 notes");
  });

  it("shows the outcome of a restore after the page reloaded", async () => {
    sessionStorage.setItem(
      "composition:backup-restored",
      JSON.stringify({ tone: "success", text: "Restored 12 notes from /b.tar.gz." }),
    );

    renderIt();

    expect((await screen.findByRole("status")).textContent).toBe("Restored 12 notes from /b.tar.gz.");
    expect(sessionStorage.getItem("composition:backup-restored")).toBeNull();
  });

  it("explains a refused backup and stays where it is", async () => {
    vi.mocked(restoreBackup).mockResolvedValue({ error: "This is not a Composition backup (or it is damaged)." });
    renderIt();
    fireEvent.change(screen.getByLabelText("Backup file"), { target: { value: "/junk" } });

    fireEvent.click(screen.getByRole("button", { name: "Restore…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    expect((await screen.findByRole("alert")).textContent).toContain("not a Composition backup");
    expect(reload).not.toHaveBeenCalled();
  });
});
