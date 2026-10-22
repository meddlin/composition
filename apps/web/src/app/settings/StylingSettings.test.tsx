// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveEditorFont, savePreviewFont } from "@/lib/composition/client";
import { EDITOR_FONT_CHOICES, editorFontStack } from "@/lib/composition/editorFonts";
import { PREVIEW_FONT_CHOICES, previewFontStack } from "@/lib/composition/previewFonts";
import { StylingSettings } from "./StylingSettings";

vi.mock("@/lib/composition/client", () => ({
  saveLocation: vi.fn(async () => ({})),
  savePreviewFont: vi.fn(async () => ({})),
  saveEditorFont: vi.fn(async () => ({})),
  saveSettings: vi.fn(async () => ({})),
  saveTheme: vi.fn(async () => ({})),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.style.removeProperty("--preview-font");
  document.documentElement.style.removeProperty("--editor-font");
});

function renderForm(currentPreviewFont: "default" | "lora" = "default", currentEditorFont: "default" | "lora" | "jetbrains-mono" = "default") {
  render(
    <StylingSettings
      currentTheme="dark"
      currentPreviewFont={currentPreviewFont}
      currentEditorFont={currentEditorFont}
      currentCity=""
    />,
  );
}

const rootFont = () => document.documentElement.style.getPropertyValue("--preview-font");

describe("preview font setting", () => {
  it("offers every font, with the saved one selected", () => {
    renderForm("lora");

    const group = screen.getByRole("radiogroup", { name: "Preview font" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(PREVIEW_FONT_CHOICES.length);
    expect(within(group).getByRole("radio", { name: "Lora" }).getAttribute("aria-checked")).toBe("true");
  });

  it("applies a chosen font straight away and saves it", async () => {
    renderForm();

    await act(async () => {
      fireEvent.click(within(screen.getByRole("radiogroup", { name: "Preview font" })).getByRole("radio", { name: "Lora" }));
    });

    expect(rootFont()).toBe(previewFontStack("lora"));
    expect(savePreviewFont).toHaveBeenCalledWith("lora");
  });

  it("puts the previous font back and says why when the save fails", async () => {
    vi.mocked(savePreviewFont).mockResolvedValueOnce({ error: "Unknown font." });
    renderForm();
    document.documentElement.style.setProperty("--preview-font", previewFontStack("default"));

    await act(async () => {
      fireEvent.click(within(screen.getByRole("radiogroup", { name: "Preview font" })).getByRole("radio", { name: "Lora" }));
    });

    expect(rootFont()).toBe(previewFontStack("default"));
    expect(screen.getByText("Unknown font.")).toBeTruthy();
    expect(within(screen.getByRole("radiogroup", { name: "Preview font" })).getByRole("radio", { name: "Geist (default)" }).getAttribute("aria-checked")).toBe("true");
  });
});

const rootEditorFont = () => document.documentElement.style.getPropertyValue("--editor-font");
const editorGroup = () => screen.getByRole("radiogroup", { name: "Editor font" });

describe("editor font setting", () => {
  it("offers every font, with the saved one selected", () => {
    renderForm("default", "jetbrains-mono");

    expect(editorGroup().querySelectorAll('[role="radio"]')).toHaveLength(EDITOR_FONT_CHOICES.length);
    expect(within(editorGroup()).getByRole("radio", { name: "JetBrains Mono" }).getAttribute("aria-checked")).toBe("true");
  });

  it("applies a chosen font straight away and saves it, without touching the preview font", async () => {
    renderForm();

    await act(async () => {
      fireEvent.click(within(editorGroup()).getByRole("radio", { name: "Lora" }));
    });

    expect(rootEditorFont()).toBe(editorFontStack("lora"));
    expect(saveEditorFont).toHaveBeenCalledWith("lora");
    expect(savePreviewFont).not.toHaveBeenCalled();
    expect(rootFont()).toBe("");
  });

  it("puts the previous font back and says why when the save fails", async () => {
    vi.mocked(saveEditorFont).mockResolvedValueOnce({ error: "Unknown font." });
    renderForm();
    document.documentElement.style.setProperty("--editor-font", editorFontStack("default"));

    await act(async () => {
      fireEvent.click(within(editorGroup()).getByRole("radio", { name: "Lora" }));
    });

    expect(rootEditorFont()).toBe(editorFontStack("default"));
    expect(screen.getByText("Unknown font.")).toBeTruthy();
    expect(within(editorGroup()).getByRole("radio", { name: "Geist Mono (default)" }).getAttribute("aria-checked")).toBe("true");
  });
});
