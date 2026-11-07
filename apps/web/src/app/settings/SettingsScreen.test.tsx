// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
afterEach(cleanup);

const snapshot: SettingsSnapshot = {
  theme: "dark",
  previewFont: "default",
  editorFont: "default",
  noteBackground: "plain",
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

  it("finds the city setting by its own heading, first", () => {
    render(<SettingsScreen snapshot={snapshot} />);

    search("city");

    expect(found()[0]).toBe("CityStyling");
  });

  it("opens the page a result is on", () => {
    render(<SettingsScreen snapshot={snapshot} />);
    search("server address");

    fireEvent.click(sidebar().getByRole("button", { name: /Server address|AI helper/ }));

    const heading = screen.getByRole("heading", { level: 2, name: "AI Configuration" });
    expect(heading.closest("section")!.hidden).toBe(false);
  });
});
