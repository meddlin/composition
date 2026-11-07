// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { revealSetting, searchSettings, type SettingsSearchPage } from "./settingsSearch";

afterEach(cleanup);

/** Renders each page's content in its own panel, the way the Settings screen does. */
function pagesOf(contents: Record<string, React.ReactNode>): SettingsSearchPage[] {
  const { container } = render(
    <>
      {Object.entries(contents).map(([id, content]) => (
        <section key={id} id={id}>
          {content}
        </section>
      ))}
    </>,
  );
  return Object.keys(contents).map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    root: container.querySelector<HTMLElement>(`#${id}`)!,
  }));
}

const titled = (title: string, body: string) => (
  <Card size="sm">
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{body}</CardDescription>
    </CardHeader>
  </Card>
);

const fieldset = (legend: string, ...options: string[]) => (
  <FieldSet>
    <FieldLegend variant="label">{legend}</FieldLegend>
    {options.map((option) => (
      <Field key={option}>
        <FieldLabel>{option}</FieldLabel>
      </Field>
    ))}
  </FieldSet>
);

describe("searchSettings", () => {
  it("finds a group by its heading, naming the page it is on", () => {
    const pages = pagesOf({ styling: fieldset("Preview font", "Lora"), writing: fieldset("Ruler", "Show a ruler") });

    const hits = searchSettings(pages, "font");

    expect(hits.map(({ title, pageId, pageLabel }) => [title, pageId, pageLabel])).toEqual([
      ["Preview font", "styling", "Styling"],
    ]);
    expect(hits[0].element.tagName).toBe("FIELDSET");
  });

  it("finds a group by what is inside it, such as an option's name", () => {
    const pages = pagesOf({ styling: fieldset("Color scheme", "Dark", "Light") });

    expect(searchSettings(pages, "dark").map((hit) => hit.title)).toEqual(["Color scheme"]);
  });

  it("matches words from their start, not from the middle", () => {
    const pages = pagesOf({ ai: titled("AI helper", "Asks a model that runs on this computer") });

    expect(searchSettings(pages, "ai")).toHaveLength(1);
    expect(searchSettings(pages, "mod")).toHaveLength(1);
    expect(searchSettings(pages, "puter")).toHaveLength(0);
  });

  it("tells a word's start from its middle by letters and digits of any script, not just ASCII ones", () => {
    const pages = pagesOf({
      general: titled("Notes", "café au lait, 2fa codes, 😀sun, 𝒜sunrise"),
    });

    expect(searchSettings(pages, "lait")).toHaveLength(1);
    expect(searchSettings(pages, "afé")).toHaveLength(0);
    expect(searchSettings(pages, "fa")).toHaveLength(0);
    expect(searchSettings(pages, "codes")).toHaveLength(1);
    // After an emoji, which is not a letter, a word starts; after a letter outside the basic plane, it does not.
    expect(searchSettings(pages, "sun")).toHaveLength(1);
    expect(searchSettings(pages, "sunrise")).toHaveLength(0);
  });

  it("finds a word at a later place in the text when it sits in the middle of a word at the first", () => {
    const pages = pagesOf({ general: titled("Notes", "unsung, then sung loudly") });

    expect(searchSettings(pages, "sung")).toHaveLength(1);
  });

  it("needs every word of the query, in any order, and ignores case", () => {
    const pages = pagesOf({ general: titled("Backup", "Saves your notes in one file") });

    expect(searchSettings(pages, "FILE  notes")).toHaveLength(1);
    expect(searchSettings(pages, "file trash")).toHaveLength(0);
  });

  it("finds nothing for an empty query, and takes punctuation literally", () => {
    const pages = pagesOf({ general: titled("Backup", "Saves (and restores) notes") });

    expect(searchSettings(pages, "   ")).toEqual([]);
    expect(searchSettings(pages, "(and")).toHaveLength(1);
    expect(searchSettings(pages, ".*")).toEqual([]);
  });

  it("lists groups whose heading matches before groups that only mention the word", () => {
    const pages = pagesOf({
      general: titled("Backup", "Also keeps your theme"),
      styling: fieldset("Theme", "Dark"),
    });

    expect(searchSettings(pages, "theme").map((hit) => hit.title)).toEqual(["Theme", "Backup"]);
  });

  it("matches the page's own name, so a page can be found by it", () => {
    const pages = pagesOf({ shortcuts: titled("Bold", "Cmd+B") });

    expect(searchSettings(pages, "shortcuts").map((hit) => hit.title)).toEqual(["Bold"]);
  });

  it("points at the outermost group, not at a fieldset inside a card", () => {
    const pages = pagesOf({
      general: (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Panels</CardTitle>
          </CardHeader>
          <CardContent>{fieldset("Icons in the plugin rail", "Notes")}</CardContent>
        </Card>
      ),
    });

    const hits = searchSettings(pages, "icons");

    expect(hits.map((hit) => hit.title)).toEqual(["Panels"]);
    expect(hits[0].element.dataset.slot).toBe("card");
  });

  it("cuts a form of fieldsets into its fieldsets, and a bare form into one group", () => {
    const pages = pagesOf({
      home: (
        <form>
          {fieldset("Open on", "Home")}
          {fieldset("Layout", "Rail")}
        </form>
      ),
      styling: (
        <form>
          <Field>
            <FieldLabel>City</FieldLabel>
          </Field>
        </form>
      ),
    });

    expect(searchSettings(pages, "rail").map((hit) => hit.title)).toEqual(["Layout"]);
    expect(searchSettings(pages, "city").map((hit) => [hit.title, hit.element.tagName])).toEqual([["City", "FORM"]]);
  });

  it("names a group with no heading of its own after its page", () => {
    const pages = pagesOf({
      shortcuts: (
        <Card size="sm">
          <CardContent>Press ? anywhere</CardContent>
        </Card>
      ),
    });

    expect(searchSettings(pages, "anywhere").map((hit) => hit.title)).toEqual(["Shortcuts"]);
  });

  it("keeps page order, then group order, within a rank", () => {
    const pages = pagesOf({
      general: (
        <>
          {titled("Backup file", "a")}
          {titled("Restore file", "b")}
        </>
      ),
      writing: titled("Reflow file", "c"),
    });

    expect(searchSettings(pages, "file").map((hit) => hit.title)).toEqual(["Backup file", "Restore file", "Reflow file"]);
  });
});

describe("revealSetting", () => {
  it("scrolls the group into view and rings it", () => {
    const [{ root }] = pagesOf({ styling: fieldset("Preview font", "Lora") });
    const group = root.querySelector<HTMLElement>("fieldset")!;
    const scrollIntoView = vi.fn();
    const animate = vi.fn();
    Object.assign(group, { scrollIntoView, animate });

    revealSetting(group);

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a group that has left the page", () => {
    const [{ root }] = pagesOf({ styling: fieldset("Preview font", "Lora") });
    const group = root.querySelector<HTMLElement>("fieldset")!;
    const scrollIntoView = vi.fn();
    Object.assign(group, { scrollIntoView });
    group.remove();

    revealSetting(group);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
