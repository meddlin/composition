// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWindowTranslucency, setWindowOpacity, setWindowTranslucency } from "@/lib/composition/windowClient";
import { WindowSettings } from "./WindowSettings";

vi.mock("@/lib/composition/windowClient", () => ({
  WINDOW_SETTINGS_AVAILABLE: true,
  getWindowTranslucency: vi.fn(),
  setWindowTranslucency: vi.fn(),
  setWindowOpacity: vi.fn(),
}));

// Radix's slider measures its thumb with a ResizeObserver, which jsdom lacks.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

beforeEach(() => {
  document.documentElement.removeAttribute("data-translucent");
  document.documentElement.style.removeProperty("--glass-alpha");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WindowSettings", () => {
  it("shows the saved choice", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: true, opacity: 0.8 });
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect(box.getAttribute("aria-checked")).toBe("true"));
  });

  it("renders nothing where the window cannot be translucent", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: false, enabled: true, opacity: 0.8 });
    const { container } = render(<WindowSettings />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });

  it("turns the window solid and the page opaque when unchecked", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: true, opacity: 0.8 });
    vi.mocked(setWindowTranslucency).mockResolvedValue({ supported: true, enabled: false, opacity: 0.8 });
    document.documentElement.setAttribute("data-translucent", "");
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    await waitFor(() => expect(document.documentElement.hasAttribute("data-translucent")).toBe(false));
    expect(setWindowTranslucency).toHaveBeenCalledWith(false);
  });

  it("makes the page see-through when checked", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: false, opacity: 0.8 });
    vi.mocked(setWindowTranslucency).mockResolvedValue({ supported: true, enabled: true, opacity: 0.8 });
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    await waitFor(() => expect(document.documentElement.hasAttribute("data-translucent")).toBe(true));
  });

  it("shows why it failed and leaves the page alone", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: true, opacity: 0.8 });
    vi.mocked(setWindowTranslucency).mockRejectedValue(new Error("boom"));
    render(<WindowSettings />);
    const box = await screen.findByRole("checkbox", { name: "Translucent window" });
    await waitFor(() => expect((box as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(box);
    expect(await screen.findByText("boom")).toBeTruthy();
  });

  it("shows the saved transparency and saves a new one when the slider moves", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: true, opacity: 0.8 });
    vi.mocked(setWindowOpacity).mockResolvedValue({ supported: true, enabled: true, opacity: 0.7 });
    render(<WindowSettings />);
    const slider = await screen.findByRole("slider", { name: "Transparency" });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("20"));
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(document.documentElement.style.getPropertyValue("--glass-alpha")).toBe("79");
    fireEvent.keyDown(slider, { key: "End" });
    await waitFor(() => expect(setWindowOpacity).toHaveBeenCalled());
    expect(document.documentElement.style.getPropertyValue("--glass-alpha")).toBe("70");
  });

  it("disables the slider while the window is solid", async () => {
    vi.mocked(getWindowTranslucency).mockResolvedValue({ supported: true, enabled: false, opacity: 0.8 });
    render(<WindowSettings />);
    const slider = await screen.findByRole("slider", { name: "Transparency" });
    expect(slider.getAttribute("data-disabled")).not.toBeNull();
  });
});
