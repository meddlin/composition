// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsSnapshot } from "@/lib/composition/api";
import { DEFAULT_ASSISTANT_SETTINGS } from "@/lib/composition/assistant/settings";
import { DEFAULT_HOME_SETTINGS } from "@/lib/composition/home";
import { DEFAULT_PLUGIN_SETTINGS } from "@/lib/composition/plugins";
import { EMPTY_TRASH } from "@/lib/composition/trash";
import { DEFAULT_WRITING_SETTINGS } from "@/lib/composition/writing";
import { SettingsScreen } from "./SettingsScreen";

// The sections reach their server actions through this module; none runs here, so each is a stub.
vi.mock("@/lib/composition/client", () => {
  const stub = () => vi.fn(async () => ({}));
  return {
    chatGptStatus: vi.fn(async () => ({ state: "signed-out" })),
    listAssistantModels: stub(),
    permanentlyDeleteGroup: stub(),
    permanentlyDeleteNote: stub(),
    restoreGroup: stub(),
    restoreNote: stub(),
    saveAssistantSettings: stub(),
    saveEditorFont: stub(),
    saveHomeSettings: stub(),
    saveLocation: stub(),
    saveNoteBackground: stub(),
    savePluginSettings: stub(),
    savePreviewFont: stub(),
    saveSettings: stub(),
    saveSunPair: stub(),
    saveTheme: stub(),
    saveWritingSettings: stub(),
    signOutChatGpt: stub(),
    startChatGptSignIn: stub(),
  };
});
vi.mock("@/lib/composition/backupClient", () => ({ BACKUP_NEEDS_PATH: true, createBackup: vi.fn(), restoreBackup: vi.fn() }));
vi.mock("@/lib/composition/updatesClient", () => ({ UPDATES_AVAILABLE: false }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.sunPair;
  delete document.documentElement.dataset.theme;
});

const snapshot: SettingsSnapshot = {
  theme: "dark",
  previewFont: "default",
  editorFont: "default",
  noteBackground: "plain",
  sunPair: "classic",
  writing: DEFAULT_WRITING_SETTINGS,
  home: DEFAULT_HOME_SETTINGS,
  plugins: DEFAULT_PLUGIN_SETTINGS,
  notebooks: [{ id: 1, name: "Work" }],
  appDataDir: "/home/me/.composition",
  dbPath: "/home/me/.composition/composition.db",
  dbPathOverride: "",
  derivedDbPath: "/home/me/.composition/composition.db",
  dirWritable: true,
  dbExists: true,
  backupDir: "/home/me/Composition Backups",
  trash: EMPTY_TRASH,
  metrics: { noteCount: 3, words: 120, characters: 700, averageWords: 40, databaseBytes: 4096, assetsBytes: 0, mediaBytes: 0 },
  assistant: DEFAULT_ASSISTANT_SETTINGS,
  city: "",
};

const sidebar = () => within(document.querySelector("aside")!);
const search = (query: string) =>
  fireEvent.change(sidebar().getByRole("searchbox", { name: "Search settings" }), { target: { value: query } });
const found = () =>
  within(sidebar().getByRole("list", { name: "Search results" }))
    .getAllByRole("button")
    .map((button) => button.textContent);

describe("the Settings screen", () => {
  it("lists its pages down the side, with General showing", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    const pages = within(sidebar().getByRole("navigation", { name: "Settings sections" })).getAllByRole("button");
    expect(pages.map((page) => page.textContent)).toEqual([
      "General",
      "Styling",
      "Follow the sun",
      "Writing",
      "Home page",
      "Plugins",
      "AI Configuration",
      "Keyboard shortcuts",
      "Metrics",
    ]);
    expect(pages[0].getAttribute("aria-current")).toBe("page");
  });

  it("keeps the just-for-fun numbers on their own Metrics page, not on General", () => {
    render(<SettingsScreen snapshot={snapshot} />);
    const section = (name: string) => screen.getByRole("heading", { level: 2, name, hidden: true }).closest("section")!;

    expect(within(section("Metrics")).getByText("Words written")).toBeTruthy();
    expect(within(section("General")).queryByText("Words written")).toBeNull();

    fireEvent.click(sidebar().getByRole("button", { name: "Metrics" }));

    expect(section("Metrics").hidden).toBe(false);
    expect(within(section("Metrics")).getByText("120")).toBeTruthy();
  });

  it("opens another page from the list", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    fireEvent.click(sidebar().getByRole("button", { name: "Keyboard shortcuts" }));

    const heading = screen.getByRole("heading", { level: 2, name: "Keyboard shortcuts" });
    expect(heading.closest("section")!.hidden).toBe(false);
    expect(screen.getByRole("heading", { level: 2, name: "General", hidden: true }).closest("section")!.hidden).toBe(true);
  });
});

describe("the Follow the sun page", () => {
  const section = (name: string) => screen.getByRole("heading", { level: 2, name, hidden: true }).closest("section")!;
  const openIt = () => fireEvent.click(sidebar().getByRole("button", { name: "Follow the sun" }));

  it("sits under Styling in the list, one level in", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    const nav = sidebar().getByRole("navigation", { name: "Settings sections" });
    const styling = within(nav).getByRole("button", { name: "Styling" }).closest("li")!;

    expect(within(styling).getByRole("button", { name: "Follow the sun" })).toBeTruthy();
    expect(within(nav).getAllByRole("list")).toHaveLength(2);
  });

  it("is reached from the Color scheme choices, which say what it is", () => {
    render(<SettingsScreen snapshot={snapshot} />);
    fireEvent.click(sidebar().getByRole("button", { name: "Styling" }));

    fireEvent.click(within(section("Styling")).getByRole("button", { name: "Choose its colors and city" }));

    expect(section("Follow the sun").hidden).toBe(false);
    expect(section("Styling").hidden).toBe(true);
    expect(sidebar().getByRole("button", { name: "Follow the sun" }).getAttribute("aria-current")).toBe("page");
  });

  it("takes you back to Styling from its own heading", () => {
    render(<SettingsScreen snapshot={snapshot} />);
    fireEvent.click(sidebar().getByRole("button", { name: "Follow the sun" }));

    fireEvent.click(within(section("Follow the sun")).getByRole("button", { name: "Styling" }));

    expect(section("Styling").hidden).toBe(false);
  });

  it("explains the scheme, takes the city, and offers every pair of colors", () => {
    render(<SettingsScreen snapshot={{ ...snapshot, city: "Austin, Texas, United States", sunPair: "mint-forest" }} />);
    openIt();
    const page = within(section("Follow the sun"));

    expect(page.getByText(/changes between its light-scheme and dark-scheme color halfway through the fade/)).toBeTruthy();
    expect((page.getByLabelText("City") as HTMLInputElement).value).toBe("Austin, Texas, United States");
    const pairs = page.getByRole("radiogroup", { name: "Light and dark colors" });
    expect(within(pairs).getAllByRole("radio").map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    expect(within(pairs).getByRole("radio", { name: "Cream to dark amber" })).toBeTruthy();
    expect(within(pairs).getByRole("radio", { name: "Light green to dark forest" })).toBeTruthy();
  });

  it("saves a chosen pair of colors and puts it on the page", async () => {
    const { saveSunPair } = await import("@/lib/composition/client");
    render(<SettingsScreen snapshot={snapshot} />);
    openIt();

    await act(async () => {
      fireEvent.click(within(section("Follow the sun")).getByRole("radio", { name: "Cream to dark amber" }));
    });

    expect(saveSunPair).toHaveBeenCalledWith("cream-amber");
    expect(document.documentElement.dataset.sunPair).toBe("cream-amber");
  });

  it("offers to switch to Follow the sun, and then says it is on, while the Color scheme choice follows", async () => {
    const { saveTheme } = await import("@/lib/composition/client");
    render(<SettingsScreen snapshot={snapshot} />);
    openIt();
    const page = within(section("Follow the sun"));

    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Use Follow the sun" }));
    });

    expect(saveTheme).toHaveBeenCalledWith("auto");
    expect(page.getByRole("status").textContent).toBe("Follow the sun is your color scheme now.");
    expect(page.queryByRole("button", { name: "Use Follow the sun" })).toBeNull();
    const scheme = within(section("Styling")).getByRole("radiogroup", { name: "Color scheme", hidden: true });
    expect(within(scheme).getByRole("radio", { name: /Follow the sun/, hidden: true }).getAttribute("aria-checked")).toBe("true");
  });

  it("is found by searching for what it does", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    search("sunrise");

    expect(found().some((hit) => hit.endsWith("Styling › Follow the sun"))).toBe(true);
  });
});

// Search reads the rendered sections, so these guard against a section being reshaped out of its reach.
describe("searching the Settings screen", () => {
  it.each([
    ["General", "Backup folder"],
    ["Styling", "Color scheme"],
    ["Writing", "ruler"],
    ["Home page", "Layout"],
    ["Plugins", "Built-in plugins"],
    ["AI Configuration", "Server address"],
    ["Keyboard shortcuts", "shortcuts"],
    ["Metrics", "words written"],
  ])("finds something on %s", (page, query) => {
    render(<SettingsScreen snapshot={snapshot} />);

    search(query);

    // A result reads as its title, then its page (the page alone when the group has no title of its own).
    expect(found().some((hit) => hit.endsWith(page))).toBe(true);
  });

  it("finds a font setting on the Styling page", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    search("editor font");

    expect(found()[0]).toBe("Editor fontStyling");
  });

  it("finds a choice by the name of one of its options", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    search("architect");

    expect(found()).toContain("Note backgroundStyling");
  });

  it("finds the AI helper's server address", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    search("ollama");

    expect(found().some((hit) => hit.endsWith("AI Configuration"))).toBe(true);
  });

  it("finds the city setting, on the Follow the sun page under Styling, first", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    search("city");

    expect(found()[0]).toBe("Your cityStyling › Follow the sun");
  });

  it("opens the page a result is on", () => {
    render(<SettingsScreen snapshot={snapshot} />);
    search("server address");

    fireEvent.click(sidebar().getByRole("button", { name: /Server address|AI helper/ }));

    const heading = screen.getByRole("heading", { level: 2, name: "AI Configuration" });
    expect(heading.closest("section")!.hidden).toBe(false);
  });
});
