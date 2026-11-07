// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveEditorFont, saveNoteBackground, savePreviewFont, saveWritingSettings } from "@/lib/composition/client";
import { EDITOR_FONT_CHOICES, editorFontStack } from "@/lib/composition/editorFonts";
import { NOTE_BACKGROUND_CHOICES } from "@/lib/composition/noteBackgrounds";
import { PREVIEW_FONT_CHOICES, previewFontStack } from "@/lib/composition/previewFonts";
import { THEME_CHOICES } from "@/lib/composition/themes";
import { ColorSchemeProvider } from "./ColorSchemeProvider";
import { StylingSettings } from "./StylingSettings";

vi.mock("@/lib/composition/client", () => ({
  savePreviewFont: vi.fn(async () => ({})),
  saveEditorFont: vi.fn(async () => ({})),
  saveNoteBackground: vi.fn(async () => ({})),
  saveSettings: vi.fn(async () => ({})),
  saveSunPair: vi.fn(async () => ({})),
  saveTheme: vi.fn(async () => ({})),
  saveWritingSettings: vi.fn(async () => ({})),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.style.removeProperty("--preview-font");
  document.documentElement.style.removeProperty("--editor-font");
  delete document.documentElement.dataset.noteBackground;
});

function renderForm(
  currentPreviewFont: "default" | "lora" = "default",
  currentEditorFont: "default" | "lora" | "jetbrains-mono" = "default",
  currentNoteBackground: "plain" | "architect" = "plain",
  currentHeadingRail = true,
  currentHeadingRailSide: "left" | "right" = "left",
) {
  render(
    <ColorSchemeProvider initialTheme="dark" initialSunPair="classic">
      <StylingSettings
        currentPreviewFont={currentPreviewFont}
        currentEditorFont={currentEditorFont}
        currentNoteBackground={currentNoteBackground}
        currentHeadingRail={currentHeadingRail}
        currentHeadingRailSide={currentHeadingRailSide}
      />
    </ColorSchemeProvider>,
  );
}

describe("color scheme setting", () => {
  it("offers every scheme, with the saved one selected", () => {
    renderForm();

    const group = screen.getByRole("radiogroup", { name: "Color scheme" });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(THEME_CHOICES.length);
    expect(within(group).getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
  });

  it("says what Follow the sun is, and leaves its settings to its own page", () => {
    renderForm();

    expect(screen.getByText(/Follow the sun fades between a light and a dark set of colors/)).toBeTruthy();
    // Outside the Settings screen there is no page to go to, so no link to it.
    expect(screen.queryByRole("button", { name: "Choose its colors and city" })).toBeNull();
    expect(screen.queryByLabelText("City")).toBeNull();
  });
});

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

const rootBackground = () => document.documentElement.dataset.noteBackground;
const backgroundGroup = () => screen.getByRole("radiogroup", { name: "Note background" });

describe("note background setting", () => {
  it("offers every background, with the saved one selected", () => {
    renderForm("default", "default", "architect");

    expect(backgroundGroup().querySelectorAll('[role="radio"]')).toHaveLength(NOTE_BACKGROUND_CHOICES.length);
    expect(within(backgroundGroup()).getByRole("radio", { name: /Architect/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("applies a chosen background straight away and saves it", async () => {
    renderForm();

    await act(async () => {
      fireEvent.click(within(backgroundGroup()).getByRole("radio", { name: /Architect/ }));
    });

    expect(rootBackground()).toBe("architect");
    expect(saveNoteBackground).toHaveBeenCalledWith("architect");
  });

  it("puts the previous background back and says why when the save fails", async () => {
    vi.mocked(saveNoteBackground).mockResolvedValueOnce({ error: "Unknown background." });
    renderForm();
    document.documentElement.dataset.noteBackground = "plain";

    await act(async () => {
      fireEvent.click(within(backgroundGroup()).getByRole("radio", { name: /Architect/ }));
    });

    expect(rootBackground()).toBe("plain");
    expect(screen.getByText("Unknown background.")).toBeTruthy();
    expect(within(backgroundGroup()).getByRole("radio", { name: "Plain" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("heading rail setting", () => {
  const checkbox = () => screen.getByRole("checkbox", { name: "Show the heading rail" });

  it("shows the saved choice", () => {
    renderForm("default", "default", "plain", false);

    expect(checkbox().getAttribute("aria-checked")).toBe("false");
  });

  it("saves only the rail when it is switched", async () => {
    renderForm();

    await act(async () => {
      fireEvent.click(checkbox());
    });

    expect(saveWritingSettings).toHaveBeenCalledWith({ headingRailEnabled: false });
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
  });

  it("goes back to what it was and says why when the save fails", async () => {
    vi.mocked(saveWritingSettings).mockResolvedValueOnce({ error: "Unknown writing setting." });
    renderForm();

    await act(async () => {
      fireEvent.click(checkbox());
    });

    expect(screen.getByText("Unknown writing setting.")).toBeTruthy();
    expect(checkbox().getAttribute("aria-checked")).toBe("true");
  });
});

describe("heading rail side setting", () => {
  const sides = () => screen.getByRole("radiogroup", { name: "Heading rail side" });

  it("offers both sides, with the saved one selected", () => {
    renderForm("default", "default", "plain", true, "right");

    expect(within(sides()).getByRole("radio", { name: "Right of the text" }).getAttribute("aria-checked")).toBe("true");
    expect(within(sides()).getByRole("radio", { name: "Left of the text" }).getAttribute("aria-checked")).toBe("false");
  });

  it("saves only the side when one is picked", async () => {
    renderForm();

    await act(async () => {
      fireEvent.click(within(sides()).getByRole("radio", { name: "Right of the text" }));
    });

    expect(saveWritingSettings).toHaveBeenCalledWith({ headingRailSide: "right" });
  });

  it("goes back to the old side and says why when the save fails", async () => {
    vi.mocked(saveWritingSettings).mockResolvedValueOnce({ error: "Unknown writing setting." });
    renderForm();

    await act(async () => {
      fireEvent.click(within(sides()).getByRole("radio", { name: "Right of the text" }));
    });

    expect(screen.getByText("Unknown writing setting.")).toBeTruthy();
    expect(within(sides()).getByRole("radio", { name: "Left of the text" }).getAttribute("aria-checked")).toBe("true");
  });
});
