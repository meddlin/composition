// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState, UpdateStateListener } from "@/lib/composition/updatesApi";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setAllowPrerelease,
  setAutoCheckUpdates,
  subscribeToUpdateState,
} from "@/lib/composition/updatesClient";
import { Updates } from "./Updates";

vi.mock("@/lib/composition/updatesClient", () => ({
  UPDATES_AVAILABLE: true,
  getUpdateState: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  setAutoCheckUpdates: vi.fn(),
  setAllowPrerelease: vi.fn(),
  subscribeToUpdateState: vi.fn(),
}));

const idle: UpdateState = { phase: "idle", currentVersion: "0.1.3", supported: true, autoCheck: true, allowPrerelease: false };
let push: UpdateStateListener;

beforeEach(() => {
  vi.mocked(getUpdateState).mockResolvedValue(idle);
  vi.mocked(subscribeToUpdateState).mockImplementation((listener) => {
    push = listener;
    return () => {};
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderIt() {
  render(<Updates />);
  await screen.findByRole("heading", { name: "Updates" });
}

describe("Updates", () => {
  it("shows where things stand and checks on request", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({ ...idle, lastCheckedAt: "2026-10-14T12:00:00Z" });
    await renderIt();
    expect(screen.getByRole("status").textContent).toBe("Composition 0.1.3. Not checked yet.");

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Composition 0.1.3. Already running the latest supported version."));
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("offers the download of an announced version, with its notes, and starts it only on a click", async () => {
    vi.mocked(downloadUpdate).mockResolvedValue({ ...idle, phase: "downloading", version: "0.2.0", percent: 0 });
    await renderIt();
    act(() => push({ ...idle, phase: "available", version: "0.2.0", releaseNotes: "Faster search" }));

    expect(screen.getByText("Faster search")).toBeTruthy();
    expect(downloadUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Download version 0.2.0" }));

    await waitFor(() => expect(downloadUpdate).toHaveBeenCalledTimes(1));
  });

  it("follows pushed progress, then offers the restart", async () => {
    vi.mocked(installUpdate).mockResolvedValue({ ...idle, phase: "ready", version: "0.2.0" });
    await renderIt();

    act(() => push({ ...idle, phase: "downloading", version: "0.2.0", percent: 40 }));
    expect(screen.getByRole("status").textContent).toBe("Downloading version 0.2.0… 40%");
    expect((screen.getByRole("button", { name: "Check for updates" }) as HTMLButtonElement).disabled).toBe(true);

    act(() => push({ ...idle, phase: "ready", version: "0.2.0" }));
    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1));
  });

  it("shows an error as an alert", async () => {
    await renderIt();
    act(() => push({ ...idle, phase: "error", error: "Couldn't reach GitHub. Check your internet connection and try again." }));
    expect(screen.getByRole("alert").textContent).toBe("Couldn't reach GitHub. Check your internet connection and try again.");
  });

  it("saves the automatic-check choice", async () => {
    vi.mocked(setAutoCheckUpdates).mockResolvedValue({ ...idle, autoCheck: false });
    await renderIt();

    const box = screen.getByLabelText("Check for updates automatically") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);

    await waitFor(() => expect(setAutoCheckUpdates).toHaveBeenCalledWith(false));
  });

  it("saves the pre-release choice, off until turned on", async () => {
    vi.mocked(setAllowPrerelease).mockResolvedValue({ ...idle, allowPrerelease: true });
    await renderIt();

    const box = screen.getByLabelText("Include pre-release versions") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);

    await waitFor(() => expect(setAllowPrerelease).toHaveBeenCalledWith(true));
  });

  it("explains instead of offering buttons when updates aren't supported", async () => {
    vi.mocked(getUpdateState).mockResolvedValue({ ...idle, supported: false, unsupportedReason: "Only in the installed app." });
    await renderIt();
    expect(screen.getByRole("status").textContent).toBe("Only in the installed app.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reports a call that fails outright", async () => {
    vi.mocked(checkForUpdates).mockRejectedValue(new Error("bridge gone"));
    await renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("bridge gone"));
  });
});
