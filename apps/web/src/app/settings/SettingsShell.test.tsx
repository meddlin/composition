// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { SettingsShell, type SettingsPage } from "./SettingsShell";

const scrollIntoView = vi.fn();

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pages: SettingsPage[] = [
  {
    id: "general",
    label: "General",
    icon: null,
    content: (
      <Card size="sm">
        <CardTitle>Backup</CardTitle>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="folder">Backup folder</FieldLabel>
            <input id="folder" defaultValue="" />
          </Field>
        </CardContent>
      </Card>
    ),
  },
  {
    id: "styling",
    label: "Styling",
    icon: null,
    content: (
      <>
        <FieldSet>
          <FieldLegend variant="label">Color scheme</FieldLegend>
        </FieldSet>
        <FieldSet>
          <FieldLegend variant="label">Preview font</FieldLegend>
        </FieldSet>
      </>
    ),
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    icon: null,
    content: (
      <Card size="sm">
        <CardContent>Press ? anywhere outside a text field</CardContent>
      </Card>
    ),
  },
];

const view = () => render(<SettingsShell pages={pages} />);
const sidebar = () => within(document.querySelector("aside")!);
const panel = (label: string) => screen.getByRole("heading", { level: 2, name: label, hidden: true }).closest("section")!;
const search = (query: string) =>
  fireEvent.change(sidebar().getByRole("searchbox", { name: "Search settings" }), { target: { value: query } });

describe("the page list", () => {
  it("lists every page and starts on the first", () => {
    view();

    const list = sidebar().getByRole("navigation", { name: "Settings sections" });
    expect(within(list).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "General",
      "Styling",
      "Keyboard shortcuts",
    ]);
    expect(within(list).getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("page");
    expect(panel("General").hidden).toBe(false);
    expect(panel("Styling").hidden).toBe(true);
  });

  it("shows the page that is chosen, and marks it", () => {
    view();

    fireEvent.click(sidebar().getByRole("button", { name: "Styling" }));

    expect(panel("Styling").hidden).toBe(false);
    expect(panel("General").hidden).toBe(true);
    expect(sidebar().getByRole("button", { name: "Styling" }).getAttribute("aria-current")).toBe("page");
    expect(sidebar().getByRole("button", { name: "General" }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps a page's half-typed form while another page shows", () => {
    view();
    const folder = screen.getByLabelText("Backup folder") as HTMLInputElement;
    fireEvent.change(folder, { target: { value: "/Volumes/Backups" } });

    fireEvent.click(sidebar().getByRole("button", { name: "Styling" }));
    fireEvent.click(sidebar().getByRole("button", { name: "General" }));

    expect((screen.getByLabelText("Backup folder") as HTMLInputElement).value).toBe("/Volumes/Backups");
  });
});

describe("searching", () => {
  it("lists the matching settings, each with its page, in place of the page list", () => {
    view();

    search("font");

    const results = sidebar().getByRole("list", { name: "Search results" });
    expect(within(results).getAllByRole("button").map((button) => button.textContent)).toEqual(["Preview fontStyling"]);
    expect(sidebar().queryByRole("button", { name: "General" })).toBeNull();
    expect(sidebar().getByRole("status").textContent).toBe("1 setting found");
  });

  it("says so when nothing matches", () => {
    view();

    search("zebra");

    expect(sidebar().getByRole("status").textContent).toBe("No settings match “zebra”.");
    expect(sidebar().queryAllByRole("listitem")).toHaveLength(0);
  });

  it("opens a result's page and scrolls to its group", async () => {
    view();
    search("preview");

    fireEvent.click(sidebar().getByRole("button", { name: /Preview font/ }));

    expect(panel("Styling").hidden).toBe(false);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(panel("Styling").querySelectorAll("fieldset")[1]);
    // The page list is back, showing where the search landed.
    expect(sidebar().getByRole("button", { name: "Styling" }).getAttribute("aria-current")).toBe("page");
    expect((sidebar().getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("scrolls to a result on the page already showing", async () => {
    view();
    search("backup");

    fireEvent.click(sidebar().getByRole("button", { name: /Backup/ }));

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(panel("General").querySelector('[data-slot="card"]'));
  });

  it("opens the first result on Enter", async () => {
    view();
    search("scheme");

    fireEvent.keyDown(sidebar().getByRole("searchbox"), { key: "Enter" });

    expect(panel("Styling").hidden).toBe(false);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(panel("Styling").querySelectorAll("fieldset")[0]);
  });

  it("clears with Escape and with the clear button", () => {
    view();
    const box = () => sidebar().getByRole("searchbox") as HTMLInputElement;

    search("font");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(box().value).toBe("");
    expect(sidebar().getByRole("button", { name: "General" })).toBeTruthy();

    search("font");
    fireEvent.click(sidebar().getByRole("button", { name: "Clear search" }));
    expect(box().value).toBe("");
    expect(sidebar().queryByRole("list", { name: "Search results" })).toBeNull();
  });

  it("finds settings on pages that are not showing", () => {
    view();

    search("anywhere");

    expect(sidebar().getByRole("button", { name: "Keyboard shortcuts" })).toBeTruthy();
  });
});

describe("the slideover menu", () => {
  it("opens the same page list and search from the Menu button", () => {
    view();

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    const menu = within(screen.getByRole("dialog", { name: "Settings" }));
    expect(menu.getByRole("searchbox", { name: "Search settings" })).toBeTruthy();
    expect(menu.getAllByRole("button", { name: /General|Styling|Keyboard shortcuts/ })).toHaveLength(3);
  });

  it("closes when a page is chosen", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Styling" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(panel("Styling").hidden).toBe(false);
  });

  it("closes when a search result is chosen", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const menu = within(screen.getByRole("dialog"));

    fireEvent.change(menu.getByRole("searchbox"), { target: { value: "scheme" } });
    fireEvent.click(menu.getByRole("button", { name: /Color scheme/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(panel("Styling").hidden).toBe(false);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });
});
