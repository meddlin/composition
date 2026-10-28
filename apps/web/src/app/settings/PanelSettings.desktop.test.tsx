// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPanelPrefs, setWarnDuplicateNotePanels, useWarnDuplicateNotePanels } from "@/components/panels/panelPrefs";
import { PanelSettings } from "./PanelSettings.desktop";

// Radix's checkbox measures itself when it is in a form; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  window.localStorage.clear();
  resetPanelPrefs();
});
afterEach(cleanup);

const warning = () => screen.getByRole("checkbox", { name: "Warn when a note is opened in more than one panel" });

describe("the panel settings", () => {
  it("shows the warning as on until the user has turned it off", () => {
    render(<PanelSettings />);

    expect(warning().getAttribute("aria-checked")).toBe("true");
  });

  it("turns it off and back on, as the box in the warning does", () => {
    function Probe() {
      return <output aria-label="warns">{String(useWarnDuplicateNotePanels())}</output>;
    }
    render(
      <>
        <PanelSettings />
        <Probe />
      </>,
    );

    fireEvent.click(warning());
    expect(warning().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("warns").textContent).toBe("false");

    fireEvent.click(warning());
    expect(screen.getByLabelText("warns").textContent).toBe("true");
  });

  it("follows the box in the warning, which turns it off from there", () => {
    render(<PanelSettings />);

    act(() => setWarnDuplicateNotePanels(false));

    expect(warning().getAttribute("aria-checked")).toBe("false");
  });
});
