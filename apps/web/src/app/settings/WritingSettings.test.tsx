// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveWritingSettings } from "@/lib/composition/client";
import { DEFAULT_WRITING_SETTINGS } from "@/lib/composition/writing";
import { WritingSettings } from "./WritingSettings";

vi.mock("@/lib/composition/client", () => ({ saveWritingSettings: vi.fn(async () => ({})) }));

// Radix's checkbox measures itself when it is in a form; jsdom has no ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const checkbox = (name: string) => screen.getByRole("checkbox", { name });
const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));

describe("writing settings", () => {
  it("starts with both off, 80 columns, and tables kept intact", () => {
    render(<WritingSettings initial={DEFAULT_WRITING_SETTINGS} />);

    expect(checkbox("Show the ruler").getAttribute("aria-checked")).toBe("false");
    expect(checkbox("Break lines as I type").getAttribute("aria-checked")).toBe("false");
    expect(checkbox("Keep Markdown tables intact").getAttribute("aria-checked")).toBe("true");
    expect(field("Ruler column").value).toBe("80");
    expect(field("Reflow column").value).toBe("80");
  });

  it("only lets a column be edited while its feature is on", () => {
    render(<WritingSettings initial={DEFAULT_WRITING_SETTINGS} />);
    expect(field("Ruler column").disabled).toBe(true);
    expect(field("Reflow column").disabled).toBe(true);
    expect(checkbox("Keep Markdown tables intact").hasAttribute("disabled")).toBe(true);

    fireEvent.click(checkbox("Show the ruler"));
    fireEvent.click(checkbox("Break lines as I type"));

    expect(field("Ruler column").disabled).toBe(false);
    expect(field("Reflow column").disabled).toBe(false);
    expect(checkbox("Keep Markdown tables intact").hasAttribute("disabled")).toBe(false);
  });

  it("saves what was chosen", async () => {
    render(<WritingSettings initial={DEFAULT_WRITING_SETTINGS} />);

    fireEvent.click(checkbox("Show the ruler"));
    fireEvent.change(field("Ruler column"), { target: { value: "100" } });
    fireEvent.click(checkbox("Break lines as I type"));
    fireEvent.change(field("Reflow column"), { target: { value: "72" } });
    fireEvent.click(checkbox("Keep Markdown tables intact"));
    await save();

    expect(saveWritingSettings).toHaveBeenCalledWith({
      rulerEnabled: true,
      rulerColumn: 100,
      reflowEnabled: true,
      reflowColumn: 72,
      reflowKeepsTables: false,
      wordCountEnabled: false,
    });
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("says what is wrong with a column instead of saving it", async () => {
    render(<WritingSettings initial={{ ...DEFAULT_WRITING_SETTINGS, rulerEnabled: true }} />);

    fireEvent.change(field("Ruler column"), { target: { value: "5" } });
    await save();

    expect(saveWritingSettings).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number of characters from 20 to 200/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the reason when the save fails", async () => {
    vi.mocked(saveWritingSettings).mockResolvedValueOnce({ error: "Could not write the settings." });
    render(<WritingSettings initial={DEFAULT_WRITING_SETTINGS} />);

    await save();

    expect(screen.getByText("Could not write the settings.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
