// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNotebook,
  deleteNotebook,
  moveGroupToNotebook,
  placeNotebook,
  renameNotebook,
  saveFavorites,
  searchNotes,
  saveHomeSettings,
} from "@/lib/composition/client";
import type { Favorites } from "@/lib/composition/favorites";
import { DEFAULT_HOME_SETTINGS, type HomeSettings } from "@/lib/composition/home";
import { DEFAULT_LAYOUT } from "@/lib/composition/layout";
import { NotesApp } from "./NotesApp";
import { resetNotebookPanelPrefs } from "./notebookPanelPrefs";
import type { Group, Note, Notebook } from "./types";

vi.mock("@/lib/composition/client", () => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  createNotebook: vi.fn(),
  deleteGroup: vi.fn(),
  deleteNote: vi.fn(),
  deleteNotebook: vi.fn(),
  moveGroup: vi.fn(),
  moveGroupToNotebook: vi.fn(),
  moveNoteToGroup: vi.fn(),
  placeGroup: vi.fn(),
  placeNote: vi.fn(),
  placeNotebook: vi.fn(),
  renameGroup: vi.fn(),
  renameNotebook: vi.fn(),
  saveFavorites: vi.fn(),
  saveHomeSettings: vi.fn(),
  saveLayout: vi.fn(),
  saveNoteContent: vi.fn(),
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

const at = "2026-01-01T00:00:00.000Z";
const notebook = (id: number, name: string): Notebook => ({ id, name, createdAt: at, updatedAt: at });
const group = (id: number, name: string, notebookId: number, parentId: number | null = null): Group => ({
  id,
  name,
  parentId,
  notebookId,
  createdAt: at,
  updatedAt: at,
});
const note = (id: number, title: string, notebookId: number, groupId: number | null = null): Note => ({
  id,
  title,
  content: "",
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId,
  notebookId,
});

const withHome = (change: Partial<HomeSettings>): HomeSettings => ({ ...DEFAULT_HOME_SETTINGS, ...change });

const notebooks = [notebook(1, "Work"), notebook(2, "Home")];
const groups = [group(1, "Projects", 1), group(2, "Chores", 2), group(3, "Garden", 2, 2)];
const notes = [note(1, "Spec", 1, 1), note(2, "Mow", 2, 3), note(3, "Empty-handed", 2)];

function renderApp(props: { notebooks?: Notebook[]; groups?: Group[]; notes?: Note[]; favorites?: Favorites; home?: HomeSettings } = {}) {
  return render(
    <NotesApp
      initialNotes={props.notes ?? notes}
      initialGroups={props.groups ?? groups}
      initialNotebooks={props.notebooks ?? notebooks}
      initialLayout={DEFAULT_LAYOUT}
      initialFavorites={props.favorites}
      initialHome={props.home}
    />,
  );
}

/** The sidebar only: an open note is also shown in its pane. */
const nav = () => within(screen.getByRole("navigation", { name: "Notes" }));

/** The notebook list beside the main sidebar. */
const panel = () => within(screen.getByRole("complementary", { name: "Notebooks" }));

/** The highlighted row is the open notebook. */
const activeNotebook = () => panel().getByRole("button", { current: true }).textContent;

function pickNotebook(name: string) {
  fireEvent.click(panel().getByRole("button", { name }));
}

beforeEach(() => {
  window.localStorage.clear();
  resetNotebookPanelPrefs();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotesApp notebooks", () => {
  it("shows only the open notebook's groups and notes", () => {
    renderApp();

    expect(nav().getByText("Projects")).toBeTruthy();
    expect(nav().getByText("Spec")).toBeTruthy();
    expect(nav().queryByText("Chores")).toBeNull();
    expect(nav().queryByText("Mow")).toBeNull();
    expect(activeNotebook()).toBe("Work");
  });

  it("highlights the open notebook in the list instead of naming it above the notes", () => {
    renderApp();

    expect(activeNotebook()).toBe("Work");
    expect(nav().queryByRole("button", { name: /^Notebook:/ })).toBeNull();

    pickNotebook("Home");
    expect(activeNotebook()).toBe("Home");
  });

  it("collapses to a rail with a button that brings the list back, and remembers that", () => {
    renderApp();

    fireEvent.click(panel().getByRole("button", { name: "Hide notebooks" }));
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();
    // With the list gone, the open notebook is named above the notes instead.
    expect(nav().getByRole("button", { name: "Notebook: Work" })).toBeTruthy();
    expect(screen.queryByRole("separator", { name: "Resize notebooks" })).toBeNull();

    cleanup();
    resetNotebookPanelPrefs();
    renderApp();
    expect(screen.queryByRole("button", { name: "Home" })).toBeNull();

    fireEvent.click(panel().getByRole("button", { name: "Show notebooks" }));
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(nav().queryByRole("button", { name: /^Notebook:/ })).toBeNull();

    // The name above the notes brings the list back too.
    fireEvent.click(panel().getByRole("button", { name: "Hide notebooks" }));
    fireEvent.click(nav().getByRole("button", { name: "Notebook: Work" }));
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
  });

  it("resizes with its divider, within limits, and remembers the width", () => {
    renderApp();
    const handle = () => screen.getByRole("separator", { name: "Resize notebooks" });
    const start = Number(handle().getAttribute("aria-valuenow"));

    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(start + 16);
    expect((panel().getByRole("heading", { name: "Notebooks" }).closest("aside") as HTMLElement).style.width).toBe(
      `${start + 16}px`,
    );

    fireEvent.pointerDown(handle(), { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 5000 });
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(360);
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: -5000 });
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(120);
    fireEvent.pointerUp(handle(), { pointerId: 1 });

    cleanup();
    resetNotebookPanelPrefs();
    renderApp();
    expect(Number(handle().getAttribute("aria-valuenow"))).toBe(120);
  });

  it("switches notebooks from the list, and remembers the choice", () => {
    renderApp();

    pickNotebook("Home");

    expect(activeNotebook()).toBe("Home");
    expect(nav().getByText("Chores")).toBeTruthy();
    expect(nav().getByText("Empty-handed")).toBeTruthy();
    expect(nav().queryByText("Projects")).toBeNull();
    expect(window.localStorage.getItem("composition.notebook")).toBe("2");

    cleanup();
    renderApp();
    expect(activeNotebook()).toBe("Home");
  });

  it("creates a notebook and opens it", async () => {
    vi.mocked(createNotebook).mockResolvedValue(notebook(3, "Reading"));
    renderApp();

    fireEvent.click(panel().getByRole("button", { name: "+ New notebook" }));
    const input = screen.getByPlaceholderText("Notebook name");
    fireEvent.change(input, { target: { value: "Reading" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(createNotebook).toHaveBeenCalledWith("Reading");
    expect(activeNotebook()).toBe("Reading");
    expect(nav().queryByText("Projects")).toBeNull();
  });

  it("renames the open notebook", async () => {
    vi.mocked(renameNotebook).mockResolvedValue(notebook(1, "Job"));
    renderApp();

    fireEvent.pointerDown(panel().getByRole("button", { name: "Actions for notebook Work" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByPlaceholderText("Notebook name") as HTMLInputElement;
    expect(input.value).toBe("Work");
    fireEvent.change(input, { target: { value: "Job" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(renameNotebook).toHaveBeenCalledWith(1, "Job");
    expect(activeNotebook()).toBe("Job");
  });

  it("reorders notebooks by dragging one onto another", async () => {
    vi.mocked(placeNotebook).mockResolvedValue([notebook(2, "Home"), notebook(1, "Work")]);
    renderApp();

    const store = new Map<string, string>();
    const dataTransfer = {
      get types() {
        return [...store.keys()];
      },
      setData: (type: string, value: string) => void store.set(type, value),
      getData: (type: string) => store.get(type) ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    const row = (name: string) => panel().getByRole("button", { name }).closest("li")!;
    fireEvent.dragStart(row("Home"), { dataTransfer });
    // jsdom has no DragEvent, so the pointer position is set by hand: above the row's middle.
    const dragAt = (type: "dragOver" | "drop") => {
      const event = createEvent[type](row("Work"), { dataTransfer });
      Object.defineProperty(event, "clientY", { value: -1 });
      return event;
    };
    fireEvent(row("Work"), dragAt("dragOver"));
    await act(async () => {
      fireEvent(row("Work"), dragAt("drop"));
    });

    expect(placeNotebook).toHaveBeenCalledWith(2, 1);
    const names = panel().getAllByRole("listitem").map((li) => li.textContent);
    expect(names.indexOf("Home")).toBeLessThan(names.indexOf("Work"));
  });

  it("offers deleting a notebook only when it is empty, and asks first", async () => {
    vi.mocked(deleteNotebook).mockResolvedValue({});
    renderApp();

    const menuFor = (name: string) =>
      fireEvent.pointerDown(panel().getByRole("button", { name: `Actions for notebook ${name}` }), {
        button: 0,
        ctrlKey: false,
      });
    menuFor("Work");
    expect(screen.getByRole("menuitem", { name: "Delete notebook" }).hasAttribute("data-disabled")).toBe(true);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  });

  it("deletes an empty notebook once confirmed, and falls back to another", async () => {
    vi.mocked(deleteNotebook).mockResolvedValue({});
    renderApp({ groups: [group(1, "Projects", 1)], notes: [] });
    pickNotebook("Home");

    fireEvent.pointerDown(panel().getByRole("button", { name: "Actions for notebook Home" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete notebook" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete notebook “Home”?")).toBeTruthy();
    expect(deleteNotebook).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    expect(deleteNotebook).toHaveBeenCalledWith(2);
    expect(activeNotebook()).toBe("Work");
  });

  it("moves a group, with its sub-groups and notes, to another notebook", async () => {
    vi.mocked(moveGroupToNotebook).mockResolvedValue({ group: { ...groups[1], parentId: null, notebookId: 1 } });
    renderApp({ notebooks, groups, notes });
    pickNotebook("Home");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Chores" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to a notebook" }));
    const target = await screen.findByRole("button", { name: "Work" });
    await act(async () => {
      fireEvent.click(target);
    });

    expect(moveGroupToNotebook).toHaveBeenCalledWith(2, 1);
    // It left this notebook, with everything inside it.
    expect(nav().queryByText("Chores")).toBeNull();
    expect(nav().queryByText("Garden")).toBeNull();
    expect(nav().getByText("Empty-handed")).toBeTruthy();

    pickNotebook("Work");
    expect(nav().getByText("Chores")).toBeTruthy();
  });

  it("puts the group back when the move is refused", async () => {
    vi.mocked(moveGroupToNotebook).mockResolvedValue({ error: "That group can't be moved there." });
    renderApp();
    pickNotebook("Home");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Chores" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to a notebook" }));
    const target = await screen.findByRole("button", { name: "Work" });
    await act(async () => {
      fireEvent.click(target);
    });

    expect(nav().getByText("Chores")).toBeTruthy();
    expect(screen.getByText("That group can't be moved there.")).toBeTruthy();
  });
});

describe("NotesApp home page", () => {
  it("shows notebooks and recent notes from the header button, and leaves when one is picked", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));

    const home = within(screen.getByRole("main", { name: "Home" }));
    expect(home.getByRole("heading", { name: "Notebooks" })).toBeTruthy();
    expect(home.getByRole("heading", { name: "Recently updated" })).toBeTruthy();

    fireEvent.click(home.getAllByRole("button")[0]);
    expect(screen.queryByRole("main", { name: "Home" })).toBeNull();
  });

  it("shows pinned notes from any notebook above the notes, in pin order", () => {
    renderApp({ favorites: [{ type: "note", id: 2 }, { type: "note", id: 1 }], home: withHome({ layout: "strip" }) });
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));

    const home = within(screen.getByRole("main", { name: "Home" }));
    const pinned = within(home.getByRole("heading", { name: "Pinned" }).closest("section")!);
    expect(pinned.getAllByRole("button", { name: /^Unpin / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Unpin Mow",
      "Unpin Spec",
    ]);
    const headings = home.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Notebooks", "Pinned", "Recently updated"]);
  });

  it("has no Pinned section until something is pinned, and pins and unpins from a card", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    const home = within(screen.getByRole("main", { name: "Home" }));
    expect(home.queryByRole("heading", { name: "Pinned" })).toBeNull();

    await act(async () => {
      fireEvent.click(home.getByRole("button", { name: "Pin Mow" }));
    });
    expect(saveFavorites).toHaveBeenLastCalledWith([{ type: "note", id: 2 }]);
    expect(home.getByRole("heading", { name: "Pinned" })).toBeTruthy();

    // Both the pinned copy and the recent copy offer to unpin.
    await act(async () => {
      fireEvent.click(home.getAllByRole("button", { name: "Unpin Mow" })[0]);
    });
    expect(saveFavorites).toHaveBeenLastCalledWith([]);
    expect(home.queryByRole("heading", { name: "Pinned" })).toBeNull();
  });

  it("puts the notebooks in a side rail beside the notes by default, and in a strip above them when chosen", () => {
    const { unmount } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    expect(screen.getByRole("main", { name: "Home" }).querySelector(".max-w-6xl")).toBeTruthy();
    unmount();

    renderApp({ home: withHome({ layout: "strip" }) });
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    const main = screen.getByRole("main", { name: "Home" });
    expect(main.querySelector(".max-w-6xl")).toBeNull();
    expect(main.querySelector(".max-w-4xl")).toBeTruthy();
  });

  const opened = () => {
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    return within(screen.getByRole("main", { name: "Home" }));
  };
  const headings = (home: ReturnType<typeof opened>) => home.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  const pins = [{ type: "note" as const, id: 1 }];

  it("shows the sections that are switched on, in the chosen order", () => {
    const sections = [
      { id: "recent" as const, visible: true },
      { id: "pinned" as const, visible: true },
      { id: "notebooks" as const, visible: false },
    ];
    renderApp({ favorites: pins, home: withHome({ layout: "strip", sections }) });

    expect(headings(opened())).toEqual(["Recently updated", "Pinned"]);
  });

  it("keeps the notebooks in the rail whatever their place in the order, and drops the rail when they are off", () => {
    const order = [
      { id: "recent" as const, visible: true },
      { id: "notebooks" as const, visible: true },
      { id: "pinned" as const, visible: true },
    ];
    const { unmount } = renderApp({ favorites: pins, home: withHome({ sections: order }) });
    let home = opened();
    // The rail comes first in the document so a narrow window shows it above the notes.
    expect(headings(home)).toEqual(["Notebooks", "Recently updated", "Pinned"]);
    expect(screen.getByRole("main", { name: "Home" }).querySelector(".max-w-6xl")).toBeTruthy();
    unmount();

    renderApp({
      favorites: pins,
      home: withHome({ sections: order.map((s) => ({ ...s, visible: s.id !== "notebooks" })) }),
    });
    home = opened();
    expect(headings(home)).toEqual(["Recently updated", "Pinned"]);
    expect(screen.getByRole("main", { name: "Home" }).querySelector(".max-w-6xl")).toBeNull();
  });

  it("says so when nothing is left to show", () => {
    renderApp({ home: withHome({ sections: DEFAULT_HOME_SETTINGS.sections.map((s) => ({ ...s, visible: s.id === "pinned" })) , layout: "strip" }) });

    expect(opened().getByText(/Nothing to show here yet/)).toBeTruthy();
  });

  it("lists only as many recent notes as asked for", () => {
    renderApp({ home: withHome({ recentCount: 6 }) });
    const home = opened();
    const section = within(home.getByRole("heading", { name: "Recently updated" }).closest("section")!);
    expect(section.getAllByRole("listitem")).toHaveLength(3);

    cleanup();
    const many = Array.from({ length: 8 }, (_, i) => note(10 + i, `Note ${i}`, 1));
    renderApp({ notes: many, home: withHome({ recentCount: 6 }) });
    const six = within(opened().getByRole("heading", { name: "Recently updated" }).closest("section")!);
    expect(six.getAllByRole("listitem")).toHaveLength(6);
  });

  it("drops the text preview of a note in the compact and list sizes", () => {
    const text = [{ ...note(1, "Spec", 1), content: "Body text of the spec" }];
    renderApp({ notes: text, home: withHome({ density: "standard" }) });
    expect(opened().getByText("Body text of the spec")).toBeTruthy();
    cleanup();

    for (const density of ["compact", "list"] as const) {
      renderApp({ notes: text, home: withHome({ density }) });
      expect(opened().queryByText("Body text of the spec")).toBeNull();
      cleanup();
    }
  });

  it("opens on a note unless the home page was chosen", () => {
    renderApp();
    expect(screen.queryByRole("main", { name: "Home" })).toBeNull();
    cleanup();

    renderApp({ home: withHome({ startup: "home" }) });
    expect(screen.getByRole("main", { name: "Home" })).toBeTruthy();
  });

  it("shows pinned notebooks and groups with the pinned notes, notebooks first", () => {
    renderApp({ favorites: [{ type: "note", id: 1 }, { type: "group", id: 2 }], home: withHome({ pinnedNotebooks: [2] }) });
    const home = opened();
    const shelf = within(home.getByRole("heading", { name: "Pinned" }).closest("section")!);

    expect(shelf.getAllByRole("button", { name: /^Unpin / }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Unpin notebook Home",
      "Unpin Spec",
      "Unpin group Chores",
    ]);
    // A group is counted with everything beneath it: Chores holds Garden, which holds Mow.
    expect(shelf.getByText("1 note", { selector: "span" })).toBeTruthy();
  });

  it("pins a notebook from its row on the home page and saves it", async () => {
    renderApp();
    const home = opened();
    expect(home.queryByRole("heading", { name: "Pinned" })).toBeNull();

    await act(async () => {
      fireEvent.click(home.getByRole("button", { name: "Pin notebook Home" }));
    });

    expect(saveHomeSettings).toHaveBeenLastCalledWith(expect.objectContaining({ pinnedNotebooks: [2] }));
    expect(home.getByRole("heading", { name: "Pinned" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(home.getAllByRole("button", { name: "Unpin notebook Home" })[0]);
    });
    expect(saveHomeSettings).toHaveBeenLastCalledWith(expect.objectContaining({ pinnedNotebooks: [] }));
    expect(home.queryByRole("heading", { name: "Pinned" })).toBeNull();
  });

  it("opens a pinned notebook, and a pinned group in another notebook, from the home page", () => {
    renderApp({ favorites: [{ type: "group", id: 2 }], home: withHome({ pinnedNotebooks: [1] }) });
    const shelf = () => within(screen.getByRole("main", { name: "Home" }).querySelector("#home-pinned")!.closest("section")!);

    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    fireEvent.click(shelf().getByRole("button", { name: /^Chores/ }));

    // Chores belongs to the Home notebook, so that notebook opens on the group's page.
    expect(screen.queryByRole("main", { name: "Home" })).toBeNull();
    expect(activeNotebook()).toMatch(/Home/);
    expect(screen.getByRole("heading", { name: "Chores" })).toBeTruthy();
  });

  it("colors a notebook as chosen", () => {
    renderApp({ home: withHome({ notebookColors: { "1": "error" } }) });
    const home = opened();
    const dot = (name: string) => home.getByRole("button", { name: new RegExp(`^${name}`) }).querySelector("span");

    expect(dot("Work")!.className).toContain("bg-error");
    // Home has no choice, so it takes the color of its place in the list (the second).
    expect(dot("Home")!.className).toContain("bg-highlight");
  });

  it("shows, hides and rewords the heading", () => {
    const { unmount } = renderApp();
    expect(opened().getByRole("heading", { level: 1 }).textContent).toBe("Welcome back");
    unmount();

    const reworded = renderApp({ home: withHome({ header: { show: true, title: "Good morning" } }) });
    expect(opened().getByRole("heading", { level: 1 }).textContent).toBe("Good morning");
    reworded.unmount();

    renderApp({ home: withHome({ header: { show: false, title: "Good morning" } }) });
    expect(opened().queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("limits recent notes to one notebook, and ignores a notebook that is gone", () => {
    const recentTitles = () =>
      within(screen.getByRole("heading", { name: "Recently updated" }).closest("section")!)
        .getAllByRole("button")
        .map((b) => b.textContent);
    const { unmount } = renderApp({ home: withHome({ recentNotebook: 2 }) });
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    expect(recentTitles().join(" ")).toMatch(/Mow/);
    expect(recentTitles().join(" ")).not.toMatch(/Spec/);
    unmount();

    renderApp({ home: withHome({ recentNotebook: 99 }) });
    fireEvent.click(screen.getByRole("button", { name: "Home page" }));
    expect(recentTitles().join(" ")).toMatch(/Spec/);
  });

  it("orders recent notes by when they were opened, and says so in the heading", () => {
    // The first note opens with the app, so it counts as opened just now; note 3 was opened later than that.
    window.localStorage.setItem("composition.opened", JSON.stringify({ 3: Date.now() + 60_000, 2: 500 }));
    renderApp({ home: withHome({ recentSort: "opened" }) });
    const home = opened();
    const section = within(home.getByRole("heading", { name: "Recently opened" }).closest("section")!);

    const titles = section.getAllByRole("button", { name: /^(Spec|Mow|Empty-handed)/ }).map((b) => b.textContent);
    expect(titles.map((t) => t!.match(/Empty-handed|Spec|Mow/)![0])).toEqual(["Empty-handed", "Spec", "Mow"]);
    window.localStorage.clear();
  });

  it("counts a note opened from the sidebar as opened", () => {
    window.localStorage.clear();
    renderApp();

    fireEvent.click(nav().getByText("Spec"));

    expect(JSON.parse(window.localStorage.getItem("composition.opened")!)).toHaveProperty("1");
    window.localStorage.clear();
  });
});

describe("NotesApp search", () => {
  it("opens the collapsed group and scrolls the sidebar to a note picked from search", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.mocked(searchNotes).mockResolvedValueOnce({
      hits: [{ id: 1, title: "Spec", description: "", groupPath: ["Projects"] }],
    });
    renderApp();
    fireEvent.click(nav().getByRole("button", { name: "Collapse Projects" }));
    expect(nav().queryByText("Spec")).toBeNull();

    fireEvent.change(screen.getByRole("combobox", { name: "Search notes" }), { target: { value: "spec" } });
    fireEvent.click(await screen.findByRole("option", { name: /Spec/ }));

    await waitFor(() => expect(nav().getByText("Spec")).toBeTruthy());
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView.mock.contexts[0]).toBe(nav().getByText("Spec").closest("div.group\\/row"));
  });
});
