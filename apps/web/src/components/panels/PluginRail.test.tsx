// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceStore, type WorkspaceStore } from "../notes/workspaceStore";
import { panelIds } from "./layoutTree";
import { resetPanelPrefs, setRailKindHidden, setShowPluginRail } from "./panelPrefs";
import { MAIN_WINDOW } from "./panelsState";
import { focusPanelElement } from "./focusPanelElement";
import { PluginRail } from "./PluginRail";

vi.mock("./focusPanelElement", () => ({ focusPanelElement: vi.fn() }));

// Radix's context menu measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  vi.mocked(focusPanelElement).mockClear();
  window.localStorage.clear();
  resetPanelPrefs();
});
afterEach(cleanup);

/** Every plugin on, which is not how a fresh install is (Reading List and RSS Reader start off). */
async function setup(showPanels?: () => void) {
  const store = createWorkspaceStore({ notes: [], groups: [] }, {} as never, undefined, { panels: {} });
  await store.plugins.setEnabled("reading-list", true);
  await store.plugins.setEnabled("rss", true);
  render(<PluginRail store={store} showPanels={showPanels} />);
  return store;
}

const rail = () => screen.queryByRole("navigation", { name: "Plugins" });
const icons = () => (rail() ? within(rail()!).getAllByRole("button").map((button) => button.getAttribute("aria-label")) : []);
const kinds = (store: WorkspaceStore) => {
  const { panels } = store.getSnapshot();
  return panelIds(panels.windows[MAIN_WINDOW].layout).map((id) => panels.byId[id].kind);
};

describe("the plugin rail", () => {
  it("has an icon for each kind of panel that can be opened, in the empty panel's order", async () => {
    await setup();

    expect(icons()).toEqual(["Notes browser", "AI helper", "To-do", "Reading List", "RSS Reader"]);
  });

  it("leaves out the icon of a plugin that is off, as a fresh install has it", async () => {
    const store = createWorkspaceStore({ notes: [], groups: [] }, {} as never, undefined, { panels: {} });
    render(<PluginRail store={store} />);

    expect(icons()).toEqual(["Notes browser", "AI helper", "To-do"]);
  });

  it("drops an icon when its plugin is turned off and brings it back when it is turned on", async () => {
    const store = await setup();

    await act(async () => void store.plugins.setEnabled("rss", false));
    expect(icons()).not.toContain("RSS Reader");

    await act(async () => void store.plugins.setEnabled("rss", true));
    expect(icons()).toContain("RSS Reader");
  });

  it("opens the kind in the main window when its icon is clicked, and asks for the panels to be shown", async () => {
    const showPanels = vi.fn();
    const store = await setup(showPanels);

    fireEvent.click(screen.getByRole("button", { name: "To-do" }));

    expect(kinds(store)).toEqual(["todo"]);
    expect(showPanels).toHaveBeenCalledTimes(1);
  });

  it("goes to the panel that is already open, instead of making another", async () => {
    const store = await setup();
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    fireEvent.click(screen.getByRole("button", { name: "AI helper" }));

    fireEvent.click(screen.getByRole("button", { name: "To-do" }));

    expect(kinds(store)).toEqual(["todo", "ai"]);
    const { panels } = store.getSnapshot();
    expect(panels.windows[MAIN_WINDOW].focusOrder[0]).toBe(panelIds(panels.windows[MAIN_WINDOW].layout)[0]);
  });

  it("shows which kinds have a panel open, and follows the panels", async () => {
    const store = await setup();
    const pressed = () => screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("aria-label"));
    expect(pressed()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "AI helper" }));
    expect(pressed()).toEqual(["AI helper"]);

    const [only] = panelIds(store.getSnapshot().panels.windows[MAIN_WINDOW].layout);
    act(() => store.closePanel(only));
    expect(pressed()).toEqual([]);
  });

  it("puts the cursor in the panel it opened, once that is drawn", async () => {
    const store = await setup();

    fireEvent.click(screen.getByRole("button", { name: "To-do" }));

    const [opened] = panelIds(store.getSnapshot().panels.windows[MAIN_WINDOW].layout);
    await waitFor(() => expect(focusPanelElement).toHaveBeenCalledWith(opened));
  });

  it("does not move the cursor or show the panels for a kind that did not open", async () => {
    const showPanels = vi.fn();
    const store = await setup(showPanels);
    await act(async () => void store.plugins.setEnabled("rss", false));

    // The icon is gone; a stale click cannot open it either, because the store refuses it.
    expect(store.openKind("rss")).toBeNull();
    expect(showPanels).not.toHaveBeenCalled();
    expect(focusPanelElement).not.toHaveBeenCalled();
  });

  it("is not shown at all when the user turned the rail off, and comes back when they turn it on", async () => {
    await setup();

    act(() => setShowPluginRail(false));
    expect(rail()).toBeNull();

    act(() => setShowPluginRail(true));
    expect(rail()).not.toBeNull();
  });

  describe("an icon the user took off the rail", () => {
    it("is gone while its plugin stays on, and the other icons stay", async () => {
      const store = await setup();

      act(() => setRailKindHidden("rss", true));

      expect(icons()).toEqual(["Notes browser", "AI helper", "To-do", "Reading List"]);
      expect(store.plugins.getSnapshot().enabled.rss).toBe(true);
      // Its panel is still there for the palette and the empty panel.
      expect(store.openKind("rss")).not.toBeNull();
    });

    it("stays gone when its plugin is turned off and on again", async () => {
      const store = await setup();
      act(() => setRailKindHidden("rss", true));

      await act(async () => void store.plugins.setEnabled("rss", false));
      await act(async () => void store.plugins.setEnabled("rss", true));

      expect(icons()).not.toContain("RSS Reader");

      act(() => setRailKindHidden("rss", false));
      expect(icons()).toContain("RSS Reader");
    });

    it("is hidden from the icon's own menu, with Hide from Rail", async () => {
      await setup();

      fireEvent.contextMenu(screen.getByRole("button", { name: "RSS Reader" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Hide from Rail" }));

      await waitFor(() => expect(icons()).not.toContain("RSS Reader"));
      expect(icons()).toContain("Reading List");
    });
  });

  it("is not there when every icon is hidden, or every plugin is off and the rest are hidden", async () => {
    const store = createWorkspaceStore({ notes: [], groups: [] }, {} as never, undefined, { panels: {} });
    render(<PluginRail store={store} />);

    act(() => {
      setRailKindHidden("notes-browser", true);
      setRailKindHidden("ai", true);
      setRailKindHidden("todo", true);
    });

    expect(rail()).toBeNull();
  });
});
