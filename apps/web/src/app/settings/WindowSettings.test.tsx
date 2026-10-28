// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWindowTranslucency, setWindowTranslucency } from "@/lib/composition/windowClient";
import { WindowSettings } from "./WindowSettings";

vi.mock("@/lib/composition/windowClient", () => ({
  WINDOW_SETTINGS_AVAILABLE: true,
  getWindowTranslucency: vi.fn(),
  setWindowTranslucency: vi.fn(),
}));

beforeEach(() => document.documentElement.removeAttribute("data-translucent"));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WindowSettings", () => {
  it("shows the saved choice", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: true });
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
  });

  it("renders nothing where the window cannot be translucent", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: false, enabled: true });
    const { container } = render(<WindowSettings />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("turns the window solid and the page opaque when unchecked", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: true });
    vi.mocked(setWindowTranslucency).mockResolvedValue({ supported: true, enabled: false });
    document.documentElement.setAttribute("data-translucent", "");
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    await waitFor(() => expect(document.documentElement.hasAttribute("data-translucent")).toBe(false));
    expect(setWindowTranslucency).toHaveBeenCalledWith(false);
  });

  it("makes the page see-through when checked", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: false });
    vi.mocked(setWindowTranslucency).mockResolvedValue({ supported: true, enabled: true });
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    await waitFor(() => expect(document.documentElement.hasAttribute("data-translucent")).toBe(true));
  });

  it("shows why it failed and leaves the page alone", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: true });
    vi.mocked(setWindowTranslucency).mockRejectedValue(new Error("boom"));
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    expect(await screen.findByText("boom")).toBeTruthy();
  });
});
