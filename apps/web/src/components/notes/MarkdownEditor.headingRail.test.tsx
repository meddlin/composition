// @vitest-environment jsdom
import { waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import { describeParity, type EditorDriver } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const NOTE = "# One\n\ntext\n\n## Two\n\n```\n# not a heading\n```\n\n### Three\n";

/** The heading rail of the editor that is showing (the Markdown tab's stays in the page, hidden, beside the live one). */
const railOf = (editor: EditorDriver) =>
  editor.element().closest("[role=tabpanel]")!.querySelector<HTMLElement>("[data-testid=heading-rail]");

// The rail of ticks, one per heading, in the plain Markdown editor and the live one.
describeParity("the editor's heading rail", (scenario) => {
  scenario("has a tick for each heading, and none for a `#` inside code", async ({ render }) => {
    const editor = render({ initial: NOTE });

    await waitFor(() => expect(railOf(editor)).not.toBeNull());
    const labels = [...railOf(editor)!.querySelectorAll("button")].map((tick) => tick.getAttribute("aria-label"));
    expect(labels).toEqual(["One", "Two", "Three"]);
  });

  scenario("is not drawn for a note with a single heading", async ({ render }) => {
    const editor = render({ initial: "# Only\n\ntext" });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(railOf(editor)).toBeNull();
  });

  scenario("is not drawn when switched off", async ({ render }) => {
    const editor = render({ initial: NOTE, writing: { headingRailEnabled: false } });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(railOf(editor)).toBeNull();
  });
});
