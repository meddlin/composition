// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteLinksProvider, type NoteLinks } from "./NoteLink";
import { NoteMarkdown } from "./NoteMarkdown";

afterEach(cleanup);

const uuid = "3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a";
const mark = "7b1d0000000000000000000000000001";
const citation = `> A quote.\n>\n> — [*Book*, p. 42](pdf:${uuid}#p=44&a=${mark})`;

function renderWith(body: string, pdf?: NoteLinks["pdf"]) {
  const links: NoteLinks = { exists: () => true, open: vi.fn(), pdf };
  render(
    <NoteLinksProvider value={links}>
      <NoteMarkdown body={body} rehypePlugins={[]} />
    </NoteLinksProvider>,
  );
  return links;
}

describe("a pdf: link in the preview", () => {
  it("is a link that shows the page and the mark it names when the PDF is here", () => {
    const pdf = { exists: vi.fn(() => true), open: vi.fn() };
    renderWith(citation, pdf);

    const link = screen.getByRole("link", { name: "Book, p. 42" });
    fireEvent.click(link);

    expect(pdf.exists).toHaveBeenCalledWith(uuid);
    expect(pdf.open).toHaveBeenCalledWith({ uuid, page: 44, mark });
    // The page is not left for the PDF's address, which would navigate the app away.
    expect(link.getAttribute("href")).toBe(`#pdf-${uuid}`);
  });

  it("is a link to the PDF as a whole when it names no page", () => {
    const pdf = { exists: () => true, open: vi.fn() };
    renderWith(`See [the book](pdf:${uuid}).`, pdf);

    fireEvent.click(screen.getByRole("link", { name: "the book" }));

    expect(pdf.open).toHaveBeenCalledWith({ uuid, page: null, mark: null });
  });

  it("is dead text, with the words still there, when the PDF is not on this device", () => {
    const pdf = { exists: () => false, open: vi.fn() };
    renderWith(citation, pdf);

    expect(screen.queryByRole("link")).toBeNull();
    const dead = screen.getByTitle("PDF not on this device");
    expect(dead.textContent).toBe("Book, p. 42");
    expect(screen.getByText(/A quote\./)).toBeTruthy();
    fireEvent.click(dead);
    expect(pdf.open).not.toHaveBeenCalled();
  });

  it("is dead text where there are no PDFs at all, as in the web app", () => {
    renderWith(citation, undefined);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTitle("PDF not on this device").textContent).toBe("Book, p. 42");
  });

  it("still works in a note that uses MDX components", () => {
    const pdf = { exists: () => true, open: vi.fn() };
    renderWith(`<Info>\n\nSee [p. 3](pdf:${uuid}#p=3)\n\n</Info>`, pdf);

    fireEvent.click(screen.getByRole("link", { name: "p. 3" }));

    expect(pdf.open).toHaveBeenCalledWith({ uuid, page: 3, mark: null });
  });

  it("leaves other links, and the dropping of unsafe ones, as they were", () => {
    renderWith(`[web](https://example.com) and [bad](javascript:alert(1)) and [odd](pdf:not-a-uuid)`, { exists: () => true, open: vi.fn() });

    expect(screen.getByRole("link", { name: "web" }).getAttribute("href")).toBe("https://example.com");
    expect(screen.getByText("bad").closest("a")?.getAttribute("href") ?? "").not.toContain("javascript");
    expect(screen.getByText("odd").closest("a")?.getAttribute("href") ?? "").not.toContain("pdf:not-a-uuid");
  });
});
