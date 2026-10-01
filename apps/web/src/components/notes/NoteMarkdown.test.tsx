// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteMarkdown } from "./NoteMarkdown";

const renderNote = (body: string) => render(<NoteMarkdown body={body} rehypePlugins={[]} />);

describe("NoteMarkdown", () => {
  afterEach(cleanup);

  it("renders <Info> as an info panel with Markdown inside", () => {
    renderNote("# Title\n\n<Info>\n\nSome **bold** advice and a [link](https://example.com).\n\n- one\n- two\n\n</Info>\n\nAfter.");

    const panel = screen.getByRole("note", { name: "Info" });
    expect(panel.querySelector("strong")?.textContent).toBe("bold");
    expect(panel.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(panel.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Title" })).toBeDefined();
    expect(screen.getByText("After.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders <Warning> next to <Info>, each with its own label", () => {
    renderNote("<Info>\n\nfyi\n\n</Info>\n\n<Warning>\n\nSome **danger**.\n\n</Warning>");

    expect(screen.getByRole("note", { name: "Info" }).textContent).toBe("fyi");
    const warning = screen.getByRole("note", { name: "Warning" });
    expect(warning.querySelector("strong")?.textContent).toBe("danger");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders GFM and nested components", () => {
    const { container } = renderNote("<Info>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n\n</Info>");

    expect(container.querySelector("[role=note] table")).not.toBeNull();
    expect(container.querySelector("[role=note] del")?.textContent).toBe("gone");
  });

  it("renders a one-line <Info>", () => {
    renderNote("<Info>Short note</Info>");

    expect(screen.getByRole("note", { name: "Info" }).textContent).toBe("Short note");
  });

  it("leaves notes without components as Markdown, so stray < and { are fine", () => {
    const { container } = renderNote("1 < 2 and {x}\n\n<https://example.com>");

    expect(container.textContent).toContain("1 < 2 and {x}");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows why and falls back to Markdown when the MDX is invalid", () => {
    renderNote("<Info>\n\nnever closed");

    expect(screen.getByRole("alert").textContent).toContain("Showing it as plain Markdown.");
    expect(screen.getByText("never closed")).toBeDefined();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("explains unknown components and expressions instead of running them", () => {
    renderNote("<Info>ok</Info>\n\n<Danger>x</Danger>");
    expect(screen.getByRole("alert").textContent).toContain("Unknown component <Danger>");
    cleanup();

    renderNote("<Info>ok</Info>\n\n{globalThis.pwned = true}");
    expect(screen.getByRole("alert").textContent).toContain("{expressions} are not supported");
    expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it.each([
    ["an unknown component", "<Danger>x</Danger>", "Unknown component <Danger>. Available: <Info>, <Warning>, <Image>."],
    ["a fragment", "<>\n\nx\n\n</>", "Fragments"],
    ["a flow expression", "{globalThis.pwned = true}", "{expressions} are not supported"],
    ["a text expression", "text {globalThis.pwned = true}", "{expressions} are not supported"],
    ["an attribute expression", "<Info prop={globalThis.pwned = true}>x</Info>", "{expressions} are not supported"],
    ["a spread attribute", "<Info {...globalThis}>x</Info>", "{expressions} are not supported"],
    ["an import", "import x from 'y'", "import and export are not supported"],
    ["an export", "export const a = globalThis.pwned = true", "import and export are not supported"],
  ])("rejects %s without running it", (_, snippet, message) => {
    renderNote(`<Info>ok</Info>\n\n${snippet}`);

    expect(screen.getByRole("alert").textContent).toContain(message);
    expect((globalThis as { pwned?: boolean }).pwned).toBeUndefined();
  });

  it("recovers once the note becomes valid", () => {
    const { rerender } = renderNote("<Info>\n\nhalf typed");
    expect(screen.getByRole("alert")).toBeDefined();

    rerender(<NoteMarkdown body={"<Info>\n\nfinished\n\n</Info>"} rehypePlugins={[]} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("note", { name: "Info" }).textContent).toBe("finished");
  });

  it("renders <Image> like Markdown's image syntax, resolving app_data paths", () => {
    renderNote('<Image src="app_data/trip-map-0123456789ab.png" alt="Route map" />');

    const img = screen.getByAltText("Route map");
    expect(img.getAttribute("src")).toBe("/app_data/trip-map-0123456789ab.png");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders <Image> inline with text, and an external src as written", () => {
    renderNote('See <Image src="https://example.com/a.png" alt="logo" /> here.');

    expect(screen.getByAltText("logo").getAttribute("src")).toBe("https://example.com/a.png");
  });

  it("still renders Markdown images in a note that also uses components", () => {
    renderNote("<Info>\n\nfyi\n\n</Info>\n\n![shot](app_data/a-0123456789ab.png)");

    expect(screen.getByAltText("shot").getAttribute("src")).toBe("/app_data/a-0123456789ab.png");
    expect(screen.getByRole("note", { name: "Info" })).toBeDefined();
  });

  it("rejects an <Image> whose src is an expression, like any other prop", () => {
    renderNote("<Image src={url} alt='x' />");

    expect(screen.getByRole("alert").textContent).toMatch(/expressions/);
  });
});
