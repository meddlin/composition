// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePluginSettings } from "@/lib/composition/client";
import { PluginsProvider } from "./PluginsProvider";
import { PluginsSettings } from "./PluginsSettings";
import { TodoLookSettings } from "./TodoLookSettings.desktop";

vi.mock("@/lib/composition/client", () => ({ savePluginSettings: vi.fn() }));
vi.mock("@/lib/composition/todosClient", () => ({ loadTodoLook: vi.fn(async () => ({ background: "notes", color: null })), saveTodoLook: vi.fn() }));
vi.mock("@/lib/composition/pluginHost", () => ({ PLUGIN_HOST: "desktop" }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  vi.mocked(savePluginSettings).mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  delete window.__workspace;
  vi.clearAllMocks();
});

const toDo = () => screen.getByRole("checkbox", { name: "To-do" });

describe("the Plugins tab", () => {
  it("lists the To-do plugin, on as the settings say", () => {
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": false }}>
        <PluginsSettings />
      </PluginsProvider>,
    );

    expect(toDo().getAttribute("aria-checked")).toBe("true");
  });

  it("lists the Reading List plugin, off until it is turned on, and saves turning it on", async () => {
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": false }}>
        <PluginsSettings />
      </PluginsProvider>,
    );
    const readingList = screen.getByRole("checkbox", { name: "Reading List" });
    expect(readingList.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(readingList);

    await waitFor(() => expect(savePluginSettings).toHaveBeenCalledWith({ todo: true, "reading-list": true }));
  });

  it("turns a plugin off and saves it", async () => {
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": false }}>
        <PluginsSettings />
      </PluginsProvider>,
    );

    fireEvent.click(toDo());

    await waitFor(() => expect(savePluginSettings).toHaveBeenCalledWith({ todo: false, "reading-list": false }));
    expect(toDo().getAttribute("aria-checked")).toBe("false");
  });

  it("puts the box back and says why when the save is refused", async () => {
    vi.mocked(savePluginSettings).mockResolvedValue({ error: "Settings could not be written." });
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": false }}>
        <PluginsSettings />
      </PluginsProvider>,
    );

    fireEvent.click(toDo());

    await screen.findByText("Settings could not be written.");
    expect(toDo().getAttribute("aria-checked")).toBe("true");
  });

  it("hides the to-do background under Styling while the plugin is off, and shows it again when it is on", async () => {
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": false }}>
        <PluginsSettings />
        <TodoLookSettings />
      </PluginsProvider>,
    );
    expect(await screen.findByText("To-do background")).toBeTruthy();

    fireEvent.click(toDo());
    await waitFor(() => expect(screen.queryByText("To-do background")).toBeNull());

    fireEvent.click(toDo());
    expect(await screen.findByText("To-do background")).toBeTruthy();
  });
});
