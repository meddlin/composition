// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearReadingData } from "@/lib/composition/readingListClient";
import { PluginsProvider } from "./PluginsProvider";
import { PluginsSettings } from "./PluginsSettings";
import { ReadingListSettings } from "./ReadingListSettings.desktop";

vi.mock("@/lib/composition/client", () => ({ savePluginSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/composition/readingListClient", () => ({ clearReadingData: vi.fn(async () => {}) }));
vi.mock("@/lib/composition/pluginHost", () => ({ PLUGIN_HOST: "desktop" }));

afterEach(() => {
  cleanup();
  delete window.__workspace;
  vi.clearAllMocks();
});

const button = () => screen.queryByRole("button", { name: "Clear browsing data" });

describe("the Reading List's Clear browsing data", () => {
  it("is not shown while the plugin is off, and appears when it is turned on", async () => {
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": false }}>
        <PluginsSettings />
        <ReadingListSettings />
      </PluginsProvider>,
    );
    expect(button()).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Reading List" }));

    await waitFor(() => expect(button()).not.toBeNull());
  });

  it("asks first, and clears nothing on Cancel", async () => {
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": true }}>
        <ReadingListSettings />
      </PluginsProvider>,
    );

    fireEvent.click(button()!);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(clearReadingData).not.toHaveBeenCalled();
  });

  it("clears the browsing data once confirmed, and says so", async () => {
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": true }}>
        <ReadingListSettings />
      </PluginsProvider>,
    );

    fireEvent.click(button()!);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear" }));

    await waitFor(() => expect(clearReadingData).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("status")).textContent).toMatch(/cleared/);
  });

  it("says why when it could not clear", async () => {
    vi.mocked(clearReadingData).mockRejectedValueOnce(new Error("The session is busy."));
    render(
      <PluginsProvider initial={{ todo: true, "reading-list": true }}>
        <ReadingListSettings />
      </PluginsProvider>,
    );

    fireEvent.click(button()!);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clear" }));

    expect(await screen.findByText("The session is busy.")).toBeTruthy();
  });
});
