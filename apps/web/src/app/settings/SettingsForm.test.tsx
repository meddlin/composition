// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { savePreviewFont } from "@/lib/composition/client";
import { PREVIEW_FONT_CHOICES, previewFontStack } from "@/lib/composition/previewFonts";
import { SettingsForm } from "./SettingsForm";

vi.mock("@/lib/composition/client", () => ({
  saveLocation: vi.fn(async () => ({})),
  savePreviewFont: vi.fn(async () => ({})),
  saveSettings: vi.fn(async () => ({})),
  saveTheme: vi.fn(async () => ({})),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.style.removeProperty("--preview-font");
});

function renderForm(currentPreviewFont: "default" | "lora" = "default") {
  render(
    <SettingsForm
      currentTheme="dark"
      currentPreviewFont={currentPreviewFont}
      currentCity=""
      currentAppDataDir="/data"
      currentDbPath=""
      derivedDbPathPlaceholder="/data/composition.db"
    />,
  );
}

const rootFont = () => document.documentElement.style.getPropertyValue("--preview-font");

describe("preview font setting", () => {
  it("offers every font, with the saved one selected", () => {
    renderForm("lora");

    const group = screen.getByRole("radiogroup", { name: "Preview font" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(PREVIEW_FONT_CHOICES.length);
    expect(screen.getByRole("radio", { name: "Lora" }).getAttribute("aria-checked")).toBe("true");
  });

  it("applies a chosen font straight away and saves it", async () => {
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Lora" }));
    });

    expect(rootFont()).toBe(previewFontStack("lora"));
    expect(savePreviewFont).toHaveBeenCalledWith("lora");
  });

  it("puts the previous font back and says why when the save fails", async () => {
    vi.mocked(savePreviewFont).mockResolvedValueOnce({ error: "Unknown font." });
    renderForm();
    document.documentElement.style.setProperty("--preview-font", previewFontStack("default"));

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Lora" }));
    });

    expect(rootFont()).toBe(previewFontStack("default"));
    expect(screen.getByText("Unknown font.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Geist (default)" }).getAttribute("aria-checked")).toBe("true");
  });
});
