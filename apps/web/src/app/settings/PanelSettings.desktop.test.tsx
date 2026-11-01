// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetPanelPrefs,
  setRailKindHidden,
  setShowPluginRail,
  setWarnDuplicateNotePanels,
  useHiddenRailKinds,
  useShowPluginRail,
  useWarnDuplicateNotePanels,
} from "@/components/panels/panelPrefs";
import { PluginsProvider } from "./PluginsProvider";
import { DEFAULT_PLUGIN_SETTINGS, type PluginSettings } from "@/lib/composition/plugins";
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

describe("the plugin rail settings", () => {
  const railBox = () => screen.getByRole("checkbox", { name: "Show the plugin rail" });
  const iconBox = (name: string) => screen.getByRole("checkbox", { name });
  const on = (name: string) => iconBox(name).getAttribute("aria-checked") === "true";
  const allOn = Object.fromEntries(Object.keys(DEFAULT_PLUGIN_SETTINGS).map((id) => [id, true])) as PluginSettings;

  function Probe() {
    return (
      <>
        <output aria-label="rail">{String(useShowPluginRail())}</output>
        <output aria-label="hidden">{useHiddenRailKinds().join(",")}</output>
      </>
    );
  }
  const renderWith = (plugins: PluginSettings) =>
    render(
      <PluginsProvider initial={plugins}>
        <PanelSettings />
        <Probe />
      </PluginsProvider>,
    );

  it("shows the rail as on, with every icon ticked, until the user chooses", () => {
    renderWith(allOn);

    expect(railBox().getAttribute("aria-checked")).toBe("true");
    for (const name of ["Notes browser", "AI helper", "To-do", "Reading List", "RSS Reader"]) expect(on(name)).toBe(true);
  });

  it("turns the whole rail off and on, for someone who works from the keyboard", () => {
    renderWith(allOn);

    fireEvent.click(railBox());
    expect(screen.getByLabelText("rail").textContent).toBe("false");
    expect(railBox().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(railBox());
    expect(screen.getByLabelText("rail").textContent).toBe("true");
  });

  it("takes one icon off the rail and puts it back, leaving the others", () => {
    renderWith(allOn);

    fireEvent.click(iconBox("RSS Reader"));
    expect(screen.getByLabelText("hidden").textContent).toBe("rss");
    expect(on("RSS Reader")).toBe(false);
    expect(on("To-do")).toBe(true);

    fireEvent.click(iconBox("RSS Reader"));
    expect(screen.getByLabelText("hidden").textContent).toBe("");
  });

  it("does not touch the plugin's own switch", () => {
    const plugins = { ...allOn };
    renderWith(plugins);

    fireEvent.click(iconBox("RSS Reader"));

    expect(plugins.rss).toBe(true);
  });

  it("disables the icons, keeping the choices, while the whole rail is off", () => {
    renderWith(allOn);
    fireEvent.click(iconBox("To-do"));

    fireEvent.click(railBox());

    expect(iconBox("AI helper").hasAttribute("disabled")).toBe(true);
    expect(on("To-do")).toBe(false);
    fireEvent.click(railBox());
    expect(iconBox("AI helper").hasAttribute("disabled")).toBe(false);
    expect(on("To-do")).toBe(false);
  });

  it("disables the icon of a plugin that is off, says so, and keeps its choice", () => {
    renderWith({ ...allOn, rss: false });

    expect(iconBox("RSS Reader").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("The plugin is turned off.")).toBeTruthy();
    expect(iconBox("AI helper").hasAttribute("disabled")).toBe(false);
  });

  it("keeps a hidden icon unticked while its plugin is off", () => {
    act(() => setRailKindHidden("rss", true));

    renderWith({ ...allOn, rss: false });

    expect(on("RSS Reader")).toBe(false);
  });

  it("follows a change made elsewhere, such as the palette's Toggle Plugin Rail or the icon's Hide from Rail", () => {
    renderWith(allOn);

    act(() => {
      setShowPluginRail(false);
      setRailKindHidden("ai", true);
    });

    expect(railBox().getAttribute("aria-checked")).toBe("false");
    expect(on("AI helper")).toBe(false);
  });
});
