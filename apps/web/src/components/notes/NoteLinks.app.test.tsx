// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT } from "@/lib/composition/layout";
import { NotesApp } from "./NotesApp";
import type { Note } from "./types";

// Every open note shows its Attachments below the editor; none of these tests are about them.
vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => []),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));

vi.mock("@/lib/composition/client", () => ({
  createGroup: vi.fn(),
  createNote: vi.fn(),
  deleteGroup: vi.fn(),
  deleteNote: vi.fn(),
  moveGroup: vi.fn(),
  moveNoteToGroup: vi.fn(),
  renameGroup: vi.fn(),
  saveLayout: vi.fn(),
  saveNoteContent: vi.fn(async (id: number, content: string) => ({ ...notes.find((n) => n.id === id)!, content })),
  searchNotes: vi.fn(async () => ({ hits: [] })),
}));

const at = "2026-01-01T00:00:00.000Z";
const makeNote = (id: number, title: string, content: string): Note => ({
  id,
  title,
  content,
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId: null,
  notebookId: 1,
});

const notes = [
  makeNote(1, "Alpha", "Go to [Beta](note:2) or [Gone](note:99)."),
  makeNote(2, "Beta", "Back to [Alpha](note:1)."),
  makeNote(3, "Gamma", "plain"),
];

// A pane is the region named by its aria-label; the Attachments section below each editor is a region too.
const paneTitles = () =>
  screen
    .getAllByRole("region")
    .filter((r) => r.hasAttribute("aria-label"))
    .map((p) => p.getAttribute("aria-label"));
const link = (pane: string, name: string) =>
  within(screen.getByRole("region", { name: pane })).getByRole("link", { name });

describe("following a note link in the preview", () => {
  afterEach(cleanup);

  function renderApp() {
    render(<NotesApp initialNotes={notes} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);
  }

  it("shows the linked note in the pane the link was in", () => {
    renderApp();
    expect(paneTitles()).toEqual(["Alpha"]);

    fireEvent.click(link("Alpha", "Beta"));

    expect(paneTitles()).toEqual(["Beta"]);
  });

  it("opens it in a new pane beside, with Cmd or Ctrl held", () => {
    renderApp();

    fireEvent.click(link("Alpha", "Beta"), { metaKey: true });

    expect(paneTitles()).toEqual(["Alpha", "Beta"]);
    expect(screen.getByRole("region", { name: "Beta" }).getAttribute("aria-current")).toBe("true");
  });

  it("focuses a linked note that is already open instead of opening it twice", () => {
    renderApp();
    fireEvent.click(link("Alpha", "Beta"), { metaKey: true });
    // A pane opened beside another starts on its editor; Beta's links are in its preview.
    fireEvent.click(within(screen.getByRole("region", { name: "Beta" })).getByRole("tab", { name: "Split" }));

    fireEvent.click(link("Beta", "Alpha"));

    expect(paneTitles()).toEqual(["Alpha", "Beta"]);
    expect(screen.getByRole("region", { name: "Alpha" }).getAttribute("aria-current")).toBe("true");
  });

  it("does not offer a link to a note that does not exist", () => {
    renderApp();

    expect(within(screen.getByRole("region", { name: "Alpha" })).queryByRole("link", { name: "Gone" })).toBeNull();
  });
});
