// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveHomeSettings } from "@/lib/composition/client";
import { DEFAULT_HOME_SETTINGS } from "@/lib/composition/home";
import { HomeSettings } from "./HomeSettings";

vi.mock("@/lib/composition/client", () => ({ saveHomeSettings: vi.fn(async () => ({})) }));

// Radix's radio group and checkbox measure themselves in a form; jsdom has no ResizeObserver.
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

const notebooks = [
  { id: 1, name: "Work" },
  { id: 2, name: "Home" },
];
const view = (initial = DEFAULT_HOME_SETTINGS) => render(<HomeSettings initial={initial} notebooks={notebooks} />);

const radio = (name: string) => screen.getByRole("radio", { name });
const checkbox = (name: string) => screen.getByRole("checkbox", { name });
const click = (element: HTMLElement) => fireEvent.click(element);
const save = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save" })));
const SECTIONS = ["Notebooks", "Pinned", "Recently updated"];
const sectionOrder = () =>
  screen
    .getAllByRole("checkbox")
    .map((box) => box.parentElement!.querySelector("label")!.textContent)
    .filter((label) => SECTIONS.includes(label!));

describe("home page settings", () => {
  it("starts from the defaults", () => {
    view();

    expect(radio("A note").getAttribute("aria-checked")).toBe("true");
    expect(radio("Side rail").getAttribute("aria-checked")).toBe("true");
    expect(radio("12").getAttribute("aria-checked")).toBe("true");
    expect(radio("Standard").getAttribute("aria-checked")).toBe("true");
    expect(radio("Last edited").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText<HTMLSelectElement>("Recent notes from").value).toBe("");
    expect(checkbox("Show a heading at the top").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText<HTMLInputElement>("Heading text").value).toBe("");
    expect(screen.getByRole("button", { name: "Work: Brand" }).getAttribute("aria-pressed")).toBe("false");
    expect(sectionOrder()).toEqual(["Notebooks", "Pinned", "Recently updated"]);
    for (const name of ["Notebooks", "Pinned", "Recently updated"]) {
      expect(checkbox(name).getAttribute("aria-checked")).toBe("true");
    }
  });

  it("saves every choice and says so", async () => {
    view();

    click(radio("The home page"));
    click(radio("Chip strip"));
    click(radio("24"));
    click(radio("List"));
    click(checkbox("Pinned"));
    click(screen.getByRole("button", { name: "Move Recently updated up" }));
    click(radio("Last opened"));
    fireEvent.change(screen.getByLabelText("Recent notes from"), { target: { value: "2" } });
    click(screen.getByRole("button", { name: "Home: Success" }));
    click(checkbox("Show a heading at the top"));
    await save();

    expect(saveHomeSettings).toHaveBeenCalledWith({
      layout: "strip",
      sections: [
        { id: "notebooks", visible: true },
        { id: "recent", visible: true },
        { id: "pinned", visible: false },
      ],
      recentCount: 24,
      density: "list",
      startup: "home",
      pinnedNotebooks: [],
      notebookColors: { "2": "success" },
      recentSort: "opened",
      recentNotebook: 2,
      header: { show: false, title: "" },
    });
    expect(screen.getByRole("status").textContent).toMatch(/Saved/);
  });

  it("keeps what is pinned to the home page when other settings are saved", async () => {
    view({ ...DEFAULT_HOME_SETTINGS, pinnedNotebooks: [2, 1] });

    click(radio("Compact"));
    await save();

    expect(saveHomeSettings).toHaveBeenCalledWith(expect.objectContaining({ pinnedNotebooks: [2, 1], density: "compact" }));
  });

  it("sets a notebook's color, and puts it back to automatic", async () => {
    view({ ...DEFAULT_HOME_SETTINGS, notebookColors: { "1": "error" } });
    expect(screen.getByRole("button", { name: "Work: Error" }).getAttribute("aria-pressed")).toBe("true");

    click(screen.getByRole("button", { name: "Work: Brand" }));
    expect(screen.getByRole("button", { name: "Work: Error" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Work: Brand" }).getAttribute("aria-pressed")).toBe("true");

    const automatic = within(screen.getByRole("group", { name: "Color of Work" })).getByRole("button", { name: "Automatic" });
    click(automatic);
    await save();

    expect(saveHomeSettings).toHaveBeenCalledWith(expect.objectContaining({ notebookColors: {} }));
  });

  it("saves a new heading, and turns its text field off with the heading", async () => {
    view();
    const title = screen.getByLabelText<HTMLInputElement>("Heading text");

    fireEvent.change(title, { target: { value: "Good morning" } });
    await save();
    expect(saveHomeSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ header: { show: true, title: "Good morning" } }),
    );

    click(checkbox("Show a heading at the top"));
    expect(title.disabled).toBe(true);
  });

  it("offers no colors when there are no notebooks yet", () => {
    render(<HomeSettings initial={DEFAULT_HOME_SETTINGS} notebooks={[]} />);

    expect(screen.queryByText("Notebook colors")).toBeNull();
  });

  it("can't move the first section up or the last one down", () => {
    view();

    expect((screen.getByRole("button", { name: "Move Notebooks up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move Recently updated down" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for another save once a choice changes after saving", async () => {
    view();
    await save();
    expect(screen.getByRole("status")).toBeTruthy();

    click(radio("Compact"));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows why a save was refused", async () => {
    vi.mocked(saveHomeSettings).mockResolvedValueOnce({ error: "Unknown card size." });
    view();

    await save();

    expect(within(document.body).getByText("Unknown card size.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
