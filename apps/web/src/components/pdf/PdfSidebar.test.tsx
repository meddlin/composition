// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PdfBookmark } from "@/lib/composition/documentsApi";
import type { DocumentsStore } from "@/lib/composition/documentsStore";
import { BookmarkList, OutlineTree, pageName } from "./PdfSidebar";
import { fakeControls } from "./fakeControls";
import type { OutlineItem, PdfViewerControls } from "./usePdfViewer";

afterEach(cleanup);

const controls = (): PdfViewerControls => fakeControls();
const item = (title: string, dest: OutlineItem["dest"] = [1], items: OutlineItem[] = []): OutlineItem => ({ title, dest, items });

describe("pageName", () => {
  it("is the printed label when the PDF has one, else the number", () => {
    expect(pageName(3, ["i", "ii", "iii", "1"])).toBe("iii");
    expect(pageName(4, ["i", "ii", "iii", "1"])).toBe("1");
    expect(pageName(5, null)).toBe("5");
    expect(pageName(9, ["i"])).toBe("9");
  });
});

describe("the outline", () => {
  it("says so when the PDF has none", () => {
    render(<OutlineTree items={[]} controls={controls()} />);

    expect(screen.getByText("This PDF has no outline.")).toBeTruthy();
  });

  it("lists the chapters, shows their sections open, and keeps deeper ones folded until asked", () => {
    const items = [item("Preface"), item("Chapter One", "ch1", [item("First section", "s1", [item("A subsection", "s1a")])])];
    render(<OutlineTree items={items} controls={controls()} />);

    expect(screen.getByRole("button", { name: "Preface" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "First section" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "A subsection" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Unfold First section" }));
    expect(screen.getByRole("button", { name: "A subsection" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fold Chapter One" }));
    expect(screen.queryByRole("button", { name: "First section" })).toBeNull();
  });

  it("goes to an entry's destination when it is clicked", () => {
    const c = controls();
    render(<OutlineTree items={[item("Chapter One", "ch1")]} controls={c} />);

    fireEvent.click(screen.getByRole("button", { name: "Chapter One" }));

    expect(c.goToDestination).toHaveBeenCalledWith("ch1");
  });

  it("names an entry with no title", () => {
    render(<OutlineTree items={[item("")]} controls={controls()} />);

    expect(screen.getByRole("button", { name: "Untitled" })).toBeTruthy();
  });
});

const bookmark = (id: number, page: number, label = ""): PdfBookmark => ({ id, uuid: String(id).padStart(32, "0"), documentId: 1, page, label, createdAt: "x" });

function documentsWith(initial: PdfBookmark[]) {
  let all = [...initial];
  return {
    listBookmarks: vi.fn(async () => all),
    renameBookmark: vi.fn(async (id: number, label: string) => {
      all = all.map((b) => (b.id === id ? { ...b, label } : b));
      return all.find((b) => b.id === id) ?? null;
    }),
    removeBookmark: vi.fn(async (id: number) => {
      all = all.filter((b) => b.id !== id);
    }),
  } as unknown as DocumentsStore & { listBookmarks: ReturnType<typeof vi.fn>; renameBookmark: ReturnType<typeof vi.fn>; removeBookmark: ReturnType<typeof vi.fn> };
}

describe("the bookmarks", () => {
  const labels = ["i", "ii", "iii", "1", "2", "3"];

  it("tells how to make one when there are none", async () => {
    render(<BookmarkList documentId={1} documents={documentsWith([])} controls={controls()} labels={null} refreshKey={0} />);

    expect(await screen.findByText(/No bookmarks yet/)).toBeTruthy();
  });

  it("lists them by their name, or by their printed page when they have none", async () => {
    render(<BookmarkList documentId={1} documents={documentsWith([bookmark(1, 3), bookmark(2, 4, "Methods")])} controls={controls()} labels={labels} refreshKey={0} />);

    const list = await screen.findByRole("list", { name: "Bookmarks" });
    expect(within(list).getByRole("button", { name: "Page 1" })).toBeTruthy();
    expect(within(list).getByRole("button", { name: /Methods/ }).textContent).toContain("Page 2");
  });

  it("goes to the page of a bookmark, which the list holds from 0 and the reader counts from 1", async () => {
    const c = controls();
    render(<BookmarkList documentId={1} documents={documentsWith([bookmark(1, 3)])} controls={c} labels={labels} refreshKey={0} />);

    fireEvent.click(await screen.findByRole("button", { name: "Page 1" }));

    expect(c.goToPage).toHaveBeenCalledWith(4);
  });

  it("renames one when Enter is pressed, and not when Escape is", async () => {
    const documents = documentsWith([bookmark(1, 3)]);
    render(<BookmarkList documentId={1} documents={documents} controls={controls()} labels={labels} refreshKey={0} />);

    fireEvent.click(await screen.findByRole("button", { name: "Rename the bookmark on page 1" }));
    const input = screen.getByRole("textbox", { name: "Bookmark name" });
    fireEvent.change(input, { target: { value: "Results" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(documents.renameBookmark).toHaveBeenCalledWith(1, "Results"));
    expect(await screen.findByRole("button", { name: /Results/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rename the bookmark on page 1" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Bookmark name" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Bookmark name" })).toBeNull();
  });

  it("removes one at once, and reads again when the toolbar adds another", async () => {
    const documents = documentsWith([bookmark(1, 3), bookmark(2, 4)]);
    const { rerender } = render(<BookmarkList documentId={1} documents={documents} controls={controls()} labels={labels} refreshKey={0} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove the bookmark on page 1" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Page 1" })).toBeNull());
    expect(documents.removeBookmark).toHaveBeenCalledWith(1);

    rerender(<BookmarkList documentId={1} documents={documents} controls={controls()} labels={labels} refreshKey={1} />);
    await waitFor(() => expect(documents.listBookmarks).toHaveBeenCalledTimes(2));
  });

  it("says when the bookmarks cannot be read", async () => {
    const documents = { listBookmarks: vi.fn(async () => Promise.reject(new Error("no"))) } as unknown as DocumentsStore;
    render(<BookmarkList documentId={1} documents={documents} controls={controls()} labels={null} refreshKey={0} />);

    expect(await screen.findByText("The bookmarks could not be read.")).toBeTruthy();
  });
});
