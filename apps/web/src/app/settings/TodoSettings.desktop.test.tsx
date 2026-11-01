// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLUGIN_SETTINGS } from "@/lib/composition/plugins";
import type { TodoSettings as Settings } from "@/lib/composition/todoSettings";
import { loadTodoSettings, previewTodoPurge, saveTodoSettings } from "@/lib/composition/todosClient";
import { PluginsProvider } from "./PluginsProvider";
import { TodoSettings } from "./TodoSettings.desktop";

vi.mock("@/lib/composition/client", () => ({ savePluginSettings: vi.fn() }));
vi.mock("@/lib/composition/pluginHost", () => ({ PLUGIN_HOST: "desktop" }));
vi.mock("@/lib/composition/todosClient", () => ({ loadTodoSettings: vi.fn(), saveTodoSettings: vi.fn(), previewTodoPurge: vi.fn() }));

const SAVED: Settings = { weekStartsOn: 1, retentionMonths: 24, fiscalYearStartMonth: 10 };

beforeEach(() => {
  vi.mocked(loadTodoSettings).mockResolvedValue(SAVED);
  vi.mocked(saveTodoSettings).mockResolvedValue(undefined);
  vi.mocked(previewTodoPurge).mockResolvedValue(0);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const weekStart = () => screen.getByLabelText("Week starts on") as HTMLSelectElement;
const fiscalStart = () => screen.getByLabelText("Fiscal year starts in") as HTMLSelectElement;
const keepFor = () => screen.getByLabelText("Keep archived items for") as HTMLSelectElement;

function renderSettings(todoPluginOn = true) {
  render(
    <PluginsProvider initial={{ ...DEFAULT_PLUGIN_SETTINGS, todo: todoPluginOn }}>
      <TodoSettings />
    </PluginsProvider>,
  );
}

async function renderLoaded() {
  renderSettings();
  await waitFor(() => expect(weekStart().value).toBe("1"));
}

describe("the to-do cycle settings", () => {
  it("shows what is saved", async () => {
    await renderLoaded();

    expect(weekStart().selectedOptions[0].textContent).toBe("Monday");
    expect(keepFor().selectedOptions[0].textContent).toBe("2 years");
    expect(fiscalStart().selectedOptions[0].textContent).toBe("October");
  });

  it("saves the day the week starts on and the fiscal month as they are picked, keeping the rest", async () => {
    await renderLoaded();

    fireEvent.change(weekStart(), { target: { value: "6" } });
    await waitFor(() => expect(saveTodoSettings).toHaveBeenLastCalledWith({ ...SAVED, weekStartsOn: 6 }));

    fireEvent.change(fiscalStart(), { target: { value: "4" } });
    await waitFor(() => expect(saveTodoSettings).toHaveBeenLastCalledWith({ weekStartsOn: 6, retentionMonths: 24, fiscalYearStartMonth: 4 }));
  });

  it("saves a longer window, and Keep forever, without asking", async () => {
    await renderLoaded();

    fireEvent.change(keepFor(), { target: { value: "60" } });
    await waitFor(() => expect(saveTodoSettings).toHaveBeenLastCalledWith({ ...SAVED, retentionMonths: 60 }));

    fireEvent.change(keepFor(), { target: { value: "forever" } });
    await waitFor(() => expect(saveTodoSettings).toHaveBeenLastCalledWith({ ...SAVED, retentionMonths: null }));
    expect(previewTodoPurge).not.toHaveBeenCalled();
  });

  it("saves a shorter window at once when it would delete nothing", async () => {
    await renderLoaded();

    fireEvent.change(keepFor(), { target: { value: "12" } });

    await waitFor(() => expect(saveTodoSettings).toHaveBeenLastCalledWith({ ...SAVED, retentionMonths: 12 }));
    expect(previewTodoPurge).toHaveBeenCalledWith(12);
  });

  it("says how many archived items a shorter window deletes, and saves it only once that is confirmed", async () => {
    vi.mocked(previewTodoPurge).mockResolvedValue(31);
    await renderLoaded();

    fireEvent.change(keepFor(), { target: { value: "12" } });

    expect(await screen.findByText(/31 archived items/)).toBeTruthy();
    expect(saveTodoSettings).not.toHaveBeenCalled();
    expect(keepFor().selectedOptions[0].textContent).toBe("2 years");

    fireEvent.click(screen.getByRole("button", { name: "Keep for 1 year" }));

    await waitFor(() => expect(saveTodoSettings).toHaveBeenLastCalledWith({ ...SAVED, retentionMonths: 12 }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(keepFor().selectedOptions[0].textContent).toBe("1 year");
  });

  it("keeps the old window, and saves nothing, when the shorter one is called off", async () => {
    vi.mocked(previewTodoPurge).mockResolvedValue(1);
    await renderLoaded();
    fireEvent.change(keepFor(), { target: { value: "12" } });
    expect(await screen.findByText(/1 archived item\b/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(saveTodoSettings).not.toHaveBeenCalled();
    expect(keepFor().selectedOptions[0].textContent).toBe("2 years");
  });

  it("asks before replacing Keep forever with a window, too", async () => {
    vi.mocked(loadTodoSettings).mockResolvedValue({ ...SAVED, retentionMonths: null });
    vi.mocked(previewTodoPurge).mockResolvedValue(5);
    renderSettings();
    await waitFor(() => expect(keepFor().value).toBe("forever"));

    fireEvent.change(keepFor(), { target: { value: "60" } });

    expect(await screen.findByText(/5 archived items/)).toBeTruthy();
    expect(previewTodoPurge).toHaveBeenCalledWith(60);
    expect(saveTodoSettings).not.toHaveBeenCalled();
  });

  it("takes any number of months from 1 to 600, and refuses the rest with a reason", async () => {
    await renderLoaded();
    fireEvent.change(keepFor(), { target: { value: "custom" } });
    const months = screen.getByLabelText("Months to keep archived items") as HTMLInputElement;
    expect(months.value).toBe("24");

    fireEvent.change(months, { target: { value: "0" } });
    fireEvent.blur(months);
    expect(await screen.findByText(/from 1 to 600/)).toBeTruthy();
    expect(saveTodoSettings).not.toHaveBeenCalled();

    fireEvent.change(months, { target: { value: "18" } });
    fireEvent.blur(months);
    await waitFor(() => expect(saveTodoSettings).toHaveBeenLastCalledWith({ ...SAVED, retentionMonths: 18 }));
    expect(screen.queryByText(/from 1 to 600/)).toBeNull();
    expect(keepFor().value).toBe("custom");
  });

  it("shows a window that is not one of the usual ones as a number of months", async () => {
    vi.mocked(loadTodoSettings).mockResolvedValue({ ...SAVED, retentionMonths: 18 });
    renderSettings();

    await waitFor(() => expect(keepFor().value).toBe("custom"));
    expect((screen.getByLabelText("Months to keep archived items") as HTMLInputElement).value).toBe("18");
  });

  it("puts the old choice back and says why when it cannot be saved", async () => {
    vi.mocked(saveTodoSettings).mockRejectedValueOnce(new Error("The disk is full."));
    await renderLoaded();

    fireEvent.change(weekStart(), { target: { value: "3" } });

    expect(await screen.findByText("The disk is full.")).toBeTruthy();
    expect(weekStart().value).toBe("1");
  });

  it("is not shown while the To-do plugin is off", async () => {
    renderSettings(false);

    expect(screen.queryByLabelText("Week starts on")).toBeNull();
    expect(loadTodoSettings).not.toHaveBeenCalled();
  });
});
