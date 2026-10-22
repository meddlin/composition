// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("plays a <YouTube> video in the preview, on its own line or inside a sentence", () => {
    const { container } = renderNote(
      'Watch this:\n\n<YouTube url="https://youtu.be/dQw4w9WgXcQ" title="Demo" />\n\nOr, inline <YouTube url="dQw4w9WgXcQ" start="1:30" /> here.',
    );

    expect(screen.getByTitle("Demo").getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
    expect(screen.getByTitle("YouTube video").getAttribute("src")).toContain("start=90");
    // Not a <div> in a <p>, which React warns about.
    expect(container.querySelector("p div")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a <Repo> card in the preview, on its own line or inside a sentence", () => {
    const { container } = renderNote(
      'See:\n\n<Repo url="https://github.com/meddlin/composition" description="Notes" />\n\nOr, inline <Repo url="gitlab.com/a/b" /> here.',
    );

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://github.com/meddlin/composition", "https://gitlab.com/a/b"]);
    // Not a <div> in a <p>, which React warns about.
    expect(container.querySelector("p div")).toBeNull();
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

  it("renders <Mark> inline, in its colour, with Markdown inside it", () => {
    const { container } = renderNote('Staging resets <Mark color="green">every **night**</Mark>, so back up <Mark>first</Mark>.');

    const marks = container.querySelectorAll("mark");
    expect([...marks].map((m) => m.getAttribute("data-color"))).toEqual(["green", "yellow"]);
    expect(marks[0].querySelector("strong")?.textContent).toBe("night");
    expect(container.querySelector("p")?.textContent).toBe("Staging resets every night, so back up first.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders what highlightRange wrote: a highlight across bold and a link", () => {
    const { container } = renderNote('<Mark color="pink">a</Mark> **<Mark color="pink">b</Mark>** [<Mark color="pink">c</Mark>](https://example.com)');

    expect(container.querySelectorAll("mark")).toHaveLength(3);
    expect(container.querySelector("strong mark")?.textContent).toBe("b");
    expect(container.querySelector("a mark")?.textContent).toBe("c");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps indented code as code in a note that uses components, as plain Markdown does", () => {
    const { container } = renderNote('before <Mark color="green">marked</Mark>\n\n    indented code\n\nafter');

    expect(container.querySelector("pre code")?.textContent).toBe("indented code\n");
    expect(screen.queryByRole("alert")).toBeNull();
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
    ["an unknown component", "<Danger>x</Danger>", "Unknown component <Danger>. Available: <Info>, <Warning>, <Image>, <Toc>, <Mark>, <Footnotes>, <YouTube>, <Repo>."],
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

  describe("<Image width>", () => {
    const widthOf = (tag: string) => {
      renderNote(tag);
      return (screen.getByAltText("shot") as HTMLImageElement).style.width;
    };

    it("draws the image that wide in pixels", () => {
      expect(widthOf('<Image src="app_data/a-0123456789ab.png" alt="shot" width="400" />')).toBe("400px");
    });

    it("takes a percentage of the note's width", () => {
      expect(widthOf('<Image src="app_data/a-0123456789ab.png" alt="shot" width="50%" />')).toBe("50%");
    });

    it("leaves the image at full size without a width, or with one it can't read", () => {
      expect(widthOf('<Image src="app_data/a-0123456789ab.png" alt="shot" />')).toBe("");
      cleanup();
      expect(widthOf('<Image src="app_data/a-0123456789ab.png" alt="shot" width="wide" />')).toBe("");
    });

    it("never lets the image outgrow the note", () => {
      renderNote('<Image src="app_data/a-0123456789ab.png" alt="shot" width="4000" />');

      expect(screen.getByAltText("shot").className).toContain("max-w-full");
    });

    it("rejects a width that is an expression, like any other prop", () => {
      renderNote('<Image src="app_data/a-0123456789ab.png" alt="shot" width={400} />');

      expect(screen.getByRole("alert").textContent).toMatch(/expressions/);
    });
  });

  it("rejects an <Image> whose src is an expression, like any other prop", () => {
    renderNote("<Image src={url} alt='x' />");

    expect(screen.getByRole("alert").textContent).toMatch(/expressions/);
  });

  describe("<Toc />", () => {
    const links = () => screen.getAllByRole("link").map((a) => a.textContent);

    it("lists the note's headings, nested by level, wherever the tag sits", () => {
      renderNote("# Guide\n\n<Toc />\n\n## Setup\n\n### Install\n\n## Usage\n\n#### Deep");

      const toc = screen.getByRole("navigation", { name: "Table of contents" });
      expect(Array.from(toc.querySelectorAll("a")).map((a) => a.textContent)).toEqual([
        "Guide",
        "Setup",
        "Install",
        "Usage",
        "Deep",
      ]);
      expect(toc.querySelectorAll("ul ul")).toHaveLength(3);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("links each entry to the id of its heading", () => {
      renderNote("<Toc />\n\n# One\n\n## Two");

      const toc = screen.getByRole("navigation");
      for (const a of Array.from(toc.querySelectorAll("a"))) {
        const heading = document.getElementById(a.getAttribute("href")!.slice(1));
        expect(heading?.textContent).toBe(a.textContent);
        expect(heading?.tagName).toMatch(/^H[12]$/);
      }
    });

    it("scrolls to the heading on click instead of changing the address", () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      renderNote("<Toc />\n\n# One\n\n## Two");

      fireEvent.click(within(screen.getByRole("navigation")).getByText("Two"));

      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("heading", { name: "Two" }));
    });

    it("follows the note as it is edited", () => {
      const { rerender } = renderNote("<Toc />\n\n# One");
      expect(links()).toEqual(["One"]);

      rerender(<NoteMarkdown body={"<Toc />\n\n# One\n\n## Added\n\n# Renamed"} rehypePlugins={[]} />);
      expect(links()).toEqual(["One", "Added", "Renamed"]);

      rerender(<NoteMarkdown body={"<Toc />\n\n## Only"} rehypePlugins={[]} />);
      expect(links()).toEqual(["Only"]);
    });

    it("uses the text of headings with inline Markdown, and keeps repeated names apart", () => {
      renderNote("<Toc />\n\n## The `code` and **bold**\n\n## Same\n\n## Same");

      expect(links()).toEqual(["The code and bold", "Same", "Same"]);
      const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
      expect(new Set(hrefs).size).toBe(3);
    });

    it("stops at maxDepth", () => {
      renderNote('<Toc maxDepth="2" />\n\n# A\n\n## B\n\n### C');

      expect(links()).toEqual(["A", "B"]);
    });

    it("says so when the note has no headings", () => {
      renderNote("<Toc />\n\nJust text.");

      expect(screen.getByText("No headings yet.")).toBeDefined();
    });

    it("does not let a note supply its own headings", () => {
      renderNote('<Toc headings="[]" />\n\n# Real');

      expect(links()).toEqual(["Real"]);
    });

    it("keeps ids apart between two notes on screen", () => {
      renderNote("<Toc />\n\n# Same");
      renderNote("<Toc />\n\n# Same");

      const ids = screen.getAllByRole("heading", { name: "Same" }).map((h) => h.id);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe("footnotes", () => {
    const cited = "Intro[^b] and more[^a].\n\n[^a]: Alpha [link](https://a.example).\n[^b]: Beta.";
    const items = () => screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/↩[\s\S]*$/, "").trim());
    const refs = (container: HTMLElement) => [...container.querySelectorAll("p sup a")].map((a) => a.textContent);

    it("lists a plain note's footnotes at its end, numbered by where they are cited, not by label", () => {
      const { container } = renderNote(cited);

      expect(refs(container)).toEqual(["1", "2"]);
      expect(items()).toEqual(["Beta.", "Alpha link."]);
      expect(container.lastElementChild?.tagName).toBe("SECTION");
    });

    it("renumbers when a footnote is added between existing ones", () => {
      const { container, rerender } = renderNote("One[^1] two[^2].\n\n[^1]: First.\n[^2]: Second.");
      expect(items()).toEqual(["First.", "Second."]);

      rerender(<NoteMarkdown body={"One[^1] new[^3] two[^2].\n\n[^1]: First.\n[^2]: Second.\n[^3]: Inserted."} rehypePlugins={[]} />);

      expect(refs(container)).toEqual(["1", "2", "3"]);
      expect(items()).toEqual(["First.", "Inserted.", "Second."]);
    });

    it("scrolls between a citation and its footnote on click instead of changing the address", () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      const { container } = renderNote(cited);
      const ref = container.querySelector<HTMLAnchorElement>("p sup a")!;
      const target = container.querySelector(`li[id]`)!;

      expect(ref.getAttribute("href")).toBe(`#${target.id}`);
      expect(fireEvent.click(ref)).toBe(false); // default prevented: no hash change
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(target);

      const back = target.querySelector<HTMLAnchorElement>("a")!;
      fireEvent.click(back);
      expect(scrollIntoView.mock.contexts[1]).toBe(ref);
    });

    it("keeps footnote ids apart between two notes on screen", () => {
      const first = renderNote(cited);
      const second = renderNote(cited);

      const ids = (c: HTMLElement) => [...c.querySelectorAll("[id]")].map((e) => e.id).filter((id) => id.includes("fn"));
      expect(ids(first.container).length).toBeGreaterThan(0);
      expect(ids(first.container).some((id) => ids(second.container).includes(id))).toBe(false);
    });

    describe("<Footnotes />", () => {
      it("puts the list where the tag is, and nowhere else", () => {
        const { container } = renderNote(`Cited[^a].\n\n<Footnotes />\n\nAfter the list.\n\n[^a]: Alpha.`);

        const list = screen.getByRole("region", { name: "Footnotes" });
        expect(list.textContent).toContain("Alpha.");
        expect(container.querySelectorAll("section")).toHaveLength(1);
        expect(container.querySelectorAll("ol")).toHaveLength(1);
        expect(list.nextElementSibling?.textContent).toBe("After the list.");
        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("numbers by citation order and links both ways, like the list at the end", () => {
        const { container } = renderNote(`Intro[^b] more[^a].\n\n[^a]: Alpha.\n[^b]: Beta.\n\n<Footnotes />`);

        expect(refs(container)).toEqual(["1", "2"]);
        expect(items()).toEqual(["Beta.", "Alpha."]);
        const ref = container.querySelector("p sup a")!;
        const target = container.querySelector(`[id="${ref.getAttribute("href")!.slice(1)}"]`)!;
        expect(target.tagName).toBe("LI");
        expect(target.querySelector("a")?.getAttribute("href")).toBe(`#${ref.id}`);
      });

      it("follows the note as it is edited", () => {
        const { rerender } = renderNote("A[^a].\n\n[^a]: Alpha.\n\n<Footnotes />");
        expect(items()).toEqual(["Alpha."]);

        rerender(<NoteMarkdown body={"A[^a] B[^b].\n\n[^a]: Alpha.\n[^b]: Beta.\n\n<Footnotes />"} rehypePlugins={[]} />);

        expect(items()).toEqual(["Alpha.", "Beta."]);
      });

      it("keeps Markdown and links inside a footnote working", () => {
        renderNote("A[^a].\n\n[^a]: **Bold** and [a link](https://a.example).\n\n<Footnotes />");

        const list = screen.getByRole("region", { name: "Footnotes" });
        expect(list.querySelector("strong")?.textContent).toBe("Bold");
        expect(list.querySelector("a[href='https://a.example']")?.textContent).toBe("a link");
      });

      it("says so when there are no footnotes", () => {
        renderNote("Just text.\n\n<Footnotes />");

        expect(screen.getByText("No footnotes yet.")).toBeDefined();
      });

      it("ignores a second tag, leaving it empty", () => {
        renderNote("A[^a].\n\n[^a]: Alpha.\n\n<Footnotes />\n\n<Footnotes />");

        const [first, second] = screen.getAllByRole("region", { name: "Footnotes" });
        expect(first.textContent).toContain("Alpha.");
        expect(second.textContent).toBe("No footnotes yet.");
      });
    });
  });
});
