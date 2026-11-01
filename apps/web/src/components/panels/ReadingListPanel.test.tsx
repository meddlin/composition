// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingItem, ReadingListApi } from "@/lib/composition/readingListApi";
import { createReadingListStore } from "@/lib/composition/readingListStore";
import type { WorkspaceStore } from "../notes/workspaceStore";
import { KINDS, type ReadingListPanelState } from "./kinds";
import { ReadingListPanel, SIDE_BY_SIDE_MIN_WIDTH } from "./ReadingListPanel";
import type { WebviewProps } from "./webviewSeam";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does no layout, so the width the panel measures is whatever the test says.
let containerWidth = 1000;
beforeEach(() => {
  containerWidth = 1000;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: containerWidth, height: 600, x: 0, y: 0, top: 0, left: 0, right: containerWidth, bottom: 600, toJSON() {} }));
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const link = (id: number, url: string, over: Partial<ReadingItem> = {}): ReadingItem => ({ id, url, title: "", read: false, createdAt: "", updatedAt: "", ...over });

/** A backend that keeps its links in memory. */
function backend(initial: ReadingItem[] = []) {
  let items = [...initial];
  let next = 100;
  const api = {
    listReadingItems: vi.fn(async () => items),
    addReadingItem: vi.fn(async (url: string) => {
      const created = link(next++, url);
      items = [...items, created];
      return created;
    }),
    setReadingItemTitle: vi.fn(async (id: number, title: string) => {
      items = items.map((i) => (i.id === id ? { ...i, title } : i));
      return items.find((i) => i.id === id)!;
    }),
    setReadingItemRead: vi.fn(async (id: number, read: boolean) => {
      items = items.map((i) => (i.id === id ? { ...i, read } : i));
      return items.find((i) => i.id === id)!;
    }),
    deleteReadingItem: vi.fn(async (id: number) => {
      items = items.filter((i) => i.id !== id);
    }),
    clearReadingData: vi.fn(async () => {}),
  } satisfies ReadingListApi;
  return api;
}

/** What the fake web view was last given, and a way to say things the page would say. */
const shown: { props: WebviewProps | null; mounts: string[] } = { props: null, mounts: [] };
function FakeWebview(props: WebviewProps) {
  useEffect(() => {
    shown.props = props;
  });
  useEffect(() => {
    shown.mounts.push(props.src);
  }, [props.src]);
  return <div data-testid="webview" data-src={props.src} />;
}

function setup(initial: ReadingItem[] = [], start: ReadingListPanelState = { selectedId: null, listWidth: 260 }) {
  shown.props = null;
  shown.mounts = [];
  const api = backend(initial);
  const readingList = createReadingListStore(api);
  let state = start;
  const setPanelState = vi.fn((_id: string, next: unknown) => {
    state = next as ReadingListPanelState;
    view.rerender(<ReadingListPanel store={store} panelId="p1" state={state} Webview={FakeWebview} />);
  });
  const store = { readingList, setPanelState } as unknown as WorkspaceStore;
  const view = render(<ReadingListPanel store={store} panelId="p1" state={state} Webview={FakeWebview} />);
  return { api, setPanelState, readingList };
}

const paste = (value: string) => {
  const box = screen.getByRole("textbox", { name: "Add a link" });
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: "Enter" });
};

const rowNames = () => within(screen.getByRole("list", { name: "Reading List" })).getAllByRole("button", { name: /^(?!Options)/ }).map((b) => b.getAttribute("aria-label"));

describe("the Reading List panel", () => {
  it("says so when there are no links yet", async () => {
    setup();
    expect(await screen.findByText(/No links yet/)).toBeTruthy();
    expect(screen.getByText("Pick an article")).toBeTruthy();
  });

  it("adds a link, shows its host until the page names it, clears the box and opens the page", async () => {
    const { setPanelState } = setup();
    await screen.findByText(/No links yet/);

    paste("www.example.com/post");

    expect(await screen.findByRole("button", { name: "example.com" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Add a link" }) as HTMLInputElement).value).toBe("");
    expect(setPanelState).toHaveBeenCalledWith("p1", { selectedId: 100, listWidth: 260 });
    expect((await screen.findByTestId("webview")).getAttribute("data-src")).toBe("https://www.example.com/post");
  });

  it("keeps what was typed and says why when the link is not a web page", async () => {
    const { api } = setup();
    await screen.findByText(/No links yet/);

    paste("javascript:alert(1)");

    expect((await screen.findByRole("alert")).textContent).toMatch(/web links/);
    expect((screen.getByRole("textbox", { name: "Add a link" }) as HTMLInputElement).value).toBe("javascript:alert(1)");
    expect(api.addReadingItem).not.toHaveBeenCalled();
  });

  it("opens the existing link instead of adding a duplicate", async () => {
    const { api, setPanelState } = setup([link(1, "https://example.com/a", { title: "A post" })]);
    await screen.findByRole("button", { name: "A post" });

    paste("example.com/a#x");

    expect((await screen.findByRole("alert")).textContent).toMatch(/already in your list: A post/);
    expect(api.addReadingItem).not.toHaveBeenCalled();
    expect(setPanelState).toHaveBeenCalledWith("p1", { selectedId: 1, listWidth: 260 });
  });

  it("lists unread links above read ones, and dims the read", async () => {
    setup([link(1, "https://a.example/", { read: true, title: "Old" }), link(2, "https://b.example/", { title: "New" })]);
    await screen.findByRole("button", { name: "New" });

    expect(rowNames()).toEqual(["New", "Old (read)"]);
  });

  it("opens the page of the link picked, and saves which one", async () => {
    const { setPanelState } = setup([link(1, "https://a.example/", { title: "First" }), link(2, "https://b.example/", { title: "Second" })]);

    fireEvent.click(await screen.findByRole("button", { name: "Second" }));

    expect(setPanelState).toHaveBeenCalledWith("p1", { selectedId: 2, listWidth: 260 });
    expect((await screen.findByTestId("webview")).getAttribute("data-src")).toBe("https://b.example/");
  });

  it("shows the link a saved selection names, and asks for another when it has since been deleted", async () => {
    setup([link(1, "https://a.example/", { title: "First" })], { selectedId: 1, listWidth: 260 });
    expect((await screen.findByTestId("webview")).getAttribute("data-src")).toBe("https://a.example/");
    cleanup();

    setup([link(1, "https://a.example/", { title: "First" })], { selectedId: 99, listWidth: 260 });
    expect(await screen.findByText("Pick an article")).toBeTruthy();
    expect(screen.queryByTestId("webview")).toBeNull();
  });

  it("gives each link a page of its own, so each has its own history", async () => {
    setup([link(1, "https://a.example/", { title: "First" }), link(2, "https://b.example/", { title: "Second" })], { selectedId: 1, listWidth: 260 });
    await screen.findByTestId("webview");

    fireEvent.click(screen.getByRole("button", { name: "Second" }));

    await waitFor(() => expect(shown.mounts).toEqual(["https://a.example/", "https://b.example/"]));
  });

  it("names a link after its page the first time, and never renames it", async () => {
    const { api } = setup([link(1, "https://a.example/")], { selectedId: 1, listWidth: 260 });
    await screen.findByTestId("webview");

    act(() => shown.props!.onChange({ title: "The Real Title" }));
    expect(await screen.findByRole("button", { name: "The Real Title" })).toBeTruthy();
    act(() => shown.props!.onChange({ title: "Some Other Page" }));

    await waitFor(() => expect(api.setReadingItemTitle).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "The Real Title" })).toBeTruthy();
  });

  it("shows the address the page is on, and drives the view's own history from the toolbar", async () => {
    setup([link(1, "https://a.example/")], { selectedId: 1, listWidth: 260 });
    await screen.findByTestId("webview");
    const calls: string[] = [];
    const handle = shown.props!.handle as { current: { back(): void; forward(): void; reload(): void } | null };
    handle.current = { back: () => calls.push("back"), forward: () => calls.push("forward"), reload: () => calls.push("reload") };

    const toolbar = screen.getByRole("toolbar", { name: "Page" });
    expect((within(toolbar).getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => shown.props!.onChange({ url: "https://a.example/next", canGoBack: true }));
    expect(within(toolbar).getByLabelText("Address").textContent).toBe("https://a.example/next");

    fireEvent.click(within(toolbar).getByRole("button", { name: "Back" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Reload" }));

    expect(calls).toEqual(["back", "reload"]);
  });

  it("opens the address now showing in the user's browser", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    setup([link(1, "https://a.example/")], { selectedId: 1, listWidth: 260 });
    await screen.findByTestId("webview");
    act(() => shown.props!.onChange({ url: "https://a.example/deeper" }));

    fireEvent.click(within(screen.getByRole("toolbar", { name: "Page" })).getByRole("button", { name: "Open in browser" }));

    expect(open).toHaveBeenCalledWith("https://a.example/deeper", "_blank", "noopener");
  });

  it("marks the open link read from the toolbar and back", async () => {
    const { api } = setup([link(1, "https://a.example/")], { selectedId: 1, listWidth: 260 });
    await screen.findByTestId("webview");

    fireEvent.click(within(screen.getByRole("toolbar", { name: "Page" })).getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(api.setReadingItemRead).toHaveBeenCalledWith(1, true));

    fireEvent.click(await within(screen.getByRole("toolbar", { name: "Page" })).findByRole("button", { name: "Mark unread" }));
    await waitFor(() => expect(api.setReadingItemRead).toHaveBeenCalledWith(1, false));
  });

  it("says why a page could not load, with a way out to the browser", async () => {
    setup([link(1, "https://a.example/")], { selectedId: 1, listWidth: 260 });
    await screen.findByTestId("webview");

    act(() => shown.props!.onChange({ failure: "ERR_NAME_NOT_RESOLVED" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not be loaded/);
    expect(alert.textContent).toMatch(/ERR_NAME_NOT_RESOLVED/);
    expect(within(alert).getByRole("button", { name: /Open in browser/ })).toBeTruthy();
  });

  describe("deleting", () => {
    async function openRowMenu(name: string) {
      const options = await screen.findByRole("button", { name: `Options for ${name}` });
      fireEvent.pointerDown(options, { button: 0, ctrlKey: false });
      fireEvent.click(options);
      return screen.findByRole("menuitem", { name: /Delete/ });
    }

    it("asks first, names the link, and sends nothing until it is confirmed", async () => {
      const { api } = setup([link(1, "https://a.example/", { title: "A post" })]);

      fireEvent.click(await openRowMenu("A post"));

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toMatch(/A post/);
      expect(dialog.textContent).toMatch(/not sent to the Trash Can/);
      expect(api.deleteReadingItem).not.toHaveBeenCalled();
      // A stray Enter backs out: Cancel holds the focus.
      expect(document.activeElement?.textContent).toBe("Cancel");
    });

    it("deletes nothing on Cancel", async () => {
      const { api } = setup([link(1, "https://a.example/", { title: "A post" })]);
      fireEvent.click(await openRowMenu("A post"));

      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(api.deleteReadingItem).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "A post" })).toBeTruthy();
    });

    it("deletes nothing on Escape", async () => {
      const { api } = setup([link(1, "https://a.example/", { title: "A post" })]);
      fireEvent.click(await openRowMenu("A post"));
      await screen.findByRole("alertdialog");

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(api.deleteReadingItem).not.toHaveBeenCalled();
    });

    it("deletes only when confirmed", async () => {
      const { api } = setup([link(1, "https://a.example/", { title: "A post" })]);
      fireEvent.click(await openRowMenu("A post"));

      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(api.deleteReadingItem).toHaveBeenCalledWith(1));
      await waitFor(() => expect(screen.queryByRole("button", { name: "A post" })).toBeNull());
    });
  });

  describe("in a narrow panel", () => {
    it("shows the list or the page, with a way back to the list", async () => {
      containerWidth = SIDE_BY_SIDE_MIN_WIDTH - 1;
      setup([link(1, "https://a.example/", { title: "First" })]);

      // Nothing is open, so the list shows and there is no divider.
      fireEvent.click(await screen.findByRole("button", { name: "First" }));
      expect(await screen.findByTestId("webview")).toBeTruthy();
      expect(screen.queryByRole("textbox", { name: "Add a link" })).toBeNull();
      expect(screen.queryByRole("separator")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /Back to list/ }));

      expect(await screen.findByRole("textbox", { name: "Add a link" })).toBeTruthy();
      expect(screen.queryByTestId("webview")).toBeNull();
    });
  });

  describe("in a wide panel", () => {
    it("shows the list and the page side by side with a divider that can be dragged and is saved", async () => {
      const { setPanelState } = setup([link(1, "https://a.example/", { title: "First" })], { selectedId: 1, listWidth: 260 });
      await screen.findByTestId("webview");
      expect(screen.getByRole("textbox", { name: "Add a link" })).toBeTruthy();
      const divider = screen.getByRole("separator", { name: "Resize the list" });
      expect(divider.getAttribute("aria-valuenow")).toBe("260");

      fireEvent.pointerDown(divider, { button: 0, clientX: 260, pointerId: 1 });
      fireEvent.pointerMove(divider, { clientX: 360, pointerId: 1 });
      fireEvent.pointerUp(divider, { pointerId: 1 });

      expect(setPanelState).toHaveBeenCalledWith("p1", { selectedId: 1, listWidth: 360 });
    });
  });
});

describe("the Reading List kind", () => {
  it("belongs to the Reading List plugin, so it is not offered or shown while the plugin is off", () => {
    expect(KINDS["reading-list"].plugin).toBe("reading-list");
  });

  it("starts with nothing open, and restores what it saved", () => {
    expect(KINDS["reading-list"].initialState()).toEqual({ selectedId: null, listWidth: 260 });
    expect(KINDS["reading-list"].restore({ selectedId: 4, listWidth: 300 }, { hasNote: () => false, hasNotebook: () => false })).toEqual({ selectedId: 4, listWidth: 300 });
  });

  it("repairs a state it cannot read rather than losing the panel, and gives up on one that is not an object", () => {
    const context = { hasNote: () => false, hasNotebook: () => false };
    expect(KINDS["reading-list"].restore({ selectedId: "4", listWidth: -5 }, context)).toEqual({ selectedId: null, listWidth: 160 });
    expect(KINDS["reading-list"].restore({}, context)).toEqual({ selectedId: null, listWidth: 260 });
    expect(KINDS["reading-list"].restore(null, context)).toBeNull();
    expect(KINDS["reading-list"].restore("x", context)).toBeNull();
  });
});
