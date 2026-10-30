import { describe, expect, it, vi } from "vitest";
import { createPluginsStore } from "./pluginsStore";

describe("the plugins store", () => {
  it("shows a change at once, tells the listeners, and saves the whole set", async () => {
    const savePluginSettings = vi.fn(async () => ({}));
    const store = createPluginsStore({ savePluginSettings });
    const listener = vi.fn();
    store.subscribe(listener);

    const pending = store.setEnabled("todo", false);

    expect(store.getSnapshot().enabled.todo).toBe(false);
    expect(listener).toHaveBeenCalled();
    expect(await pending).toEqual({});
    expect(savePluginSettings).toHaveBeenCalledWith({ todo: false, "reading-list": false });
  });

  it("saves nothing when the plugin is already as asked", async () => {
    const savePluginSettings = vi.fn(async () => ({}));
    const store = createPluginsStore({ savePluginSettings });

    await store.setEnabled("todo", true);

    expect(savePluginSettings).not.toHaveBeenCalled();
  });

  it("puts the change back and says why when the save is refused", async () => {
    const store = createPluginsStore({ savePluginSettings: async () => ({ error: "Disk is full." }) });

    expect(await store.setEnabled("todo", false)).toEqual({ error: "Disk is full." });

    expect(store.getSnapshot()).toEqual({ enabled: { todo: true, "reading-list": false }, error: "Disk is full." });
  });

  it("puts the change back when the save fails outright", async () => {
    const store = createPluginsStore({ savePluginSettings: () => Promise.reject(new Error("The bridge is gone.")) });

    await store.setEnabled("todo", false);

    expect(store.getSnapshot()).toEqual({ enabled: { todo: true, "reading-list": false }, error: "The bridge is gone." });
  });

  it("takes the saved version without saving it again, and only announces a real change", () => {
    const savePluginSettings = vi.fn(async () => ({}));
    const store = createPluginsStore({ savePluginSettings });
    const listener = vi.fn();
    store.subscribe(listener);

    store.replace({ todo: true, "reading-list": false });
    expect(listener).not.toHaveBeenCalled();

    store.replace({ todo: false, "reading-list": false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().enabled.todo).toBe(false);
    expect(savePluginSettings).not.toHaveBeenCalled();
  });
});
