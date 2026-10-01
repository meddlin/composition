// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAttachments,
  listAttachments,
  removeAttachment,
  revealAttachment,
  saveAttachmentCopy,
  type Attachment,
} from "@/lib/composition/attachmentsClient";
import { AttachmentsPanel } from "./AttachmentsPanel";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  listAttachments: vi.fn(),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));

const attachment = (id: number, fileName: string, size = 2048): Attachment => ({
  id,
  noteId: 1,
  fileName,
  size,
  createdAt: "2026-03-04T12:00:00.000Z",
});

beforeEach(() => {
  vi.mocked(listAttachments).mockResolvedValue([]);
  vi.mocked(addAttachments).mockResolvedValue({ attachments: [] });
  vi.mocked(revealAttachment).mockResolvedValue({});
  vi.mocked(saveAttachmentCopy).mockResolvedValue({});
  vi.mocked(removeAttachment).mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const attachButton = () => screen.getByRole("button", { name: "Attach files" });

describe("AttachmentsPanel", () => {
  it("shows only the attach button, and no table, when the note has no attachments", async () => {
    render(<AttachmentsPanel noteId={1} />);

    await waitFor(() => expect(listAttachments).toHaveBeenCalledWith(1));

    expect(attachButton()).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the attachments in a table with their name, size and date", async () => {
    vi.mocked(listAttachments).mockResolvedValue([
      attachment(1, "itinerary.pdf", 1_400_000),
      attachment(2, "notes.txt", 812),
    ]);
    render(<AttachmentsPanel noteId={1} />);

    const table = await screen.findByRole("table");

    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Size",
      "Added",
      "Actions",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("itinerary.pdf")).toBeTruthy();
    expect(within(rows[0]).getByText("1.4 MB")).toBeTruthy();
    expect(within(rows[1]).getByText("812 B")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Attachments (2)" })).toBeTruthy();
  });

  it("adds the chosen files to the table", async () => {
    vi.mocked(addAttachments).mockResolvedValue({ attachments: [attachment(5, "photo.png"), attachment(6, "a.zip")] });
    render(<AttachmentsPanel noteId={1} />);
    await waitFor(() => expect(listAttachments).toHaveBeenCalled());

    fireEvent.click(attachButton());

    expect(await screen.findByText("photo.png")).toBeTruthy();
    expect(screen.getByText("a.zip")).toBeTruthy();
    expect(addAttachments).toHaveBeenCalledWith(1);
  });

  it("does nothing, and shows no error, when the picker is cancelled", async () => {
    render(<AttachmentsPanel noteId={1} />);
    await waitFor(() => expect(listAttachments).toHaveBeenCalled());

    fireEvent.click(attachButton());

    await waitFor(() => expect(addAttachments).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows what went wrong while keeping the files that were attached", async () => {
    vi.mocked(addAttachments).mockResolvedValue({
      attachments: [attachment(5, "ok.txt")],
      error: "photos: only files can be attached, not folders.",
    });
    render(<AttachmentsPanel noteId={1} />);
    await waitFor(() => expect(listAttachments).toHaveBeenCalled());

    fireEvent.click(attachButton());

    expect((await screen.findByRole("alert")).textContent).toMatch(/photos: only files can be attached/);
    expect(screen.getByText("ok.txt")).toBeTruthy();
  });

  it("reveals the file and saves a copy through the desktop app", async () => {
    vi.mocked(listAttachments).mockResolvedValue([attachment(7, "report.pdf")]);
    render(<AttachmentsPanel noteId={1} />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Show report.pdf in Finder" }));
    fireEvent.click(screen.getByRole("button", { name: "Save a copy of report.pdf" }));

    await waitFor(() => expect(saveAttachmentCopy).toHaveBeenCalledWith(7));
    expect(revealAttachment).toHaveBeenCalledWith(7);
  });

  it("asks before removing, and removes only on the second click", async () => {
    vi.mocked(listAttachments).mockResolvedValue([attachment(7, "report.pdf"), attachment(8, "other.txt")]);
    render(<AttachmentsPanel noteId={1} />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Remove report.pdf" }));
    expect(removeAttachment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove report.pdf?" }));

    await waitFor(() => expect(screen.queryByText("report.pdf")).toBeNull());
    expect(removeAttachment).toHaveBeenCalledWith(7);
    expect(screen.getByText("other.txt")).toBeTruthy();
  });

  it("keeps the attachment when removal is cancelled or fails", async () => {
    vi.mocked(listAttachments).mockResolvedValue([attachment(7, "report.pdf")]);
    vi.mocked(removeAttachment).mockResolvedValue({ error: "That attachment no longer exists." });
    render(<AttachmentsPanel noteId={1} />);
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "Remove report.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Remove report.pdf" })).toBeTruthy();
    expect(removeAttachment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove report.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove report.pdf?" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That attachment no longer exists.");
    expect(screen.getByText("report.pdf")).toBeTruthy();
  });

  it("loads the new note's attachments when the pane is keyed to another note", async () => {
    vi.mocked(listAttachments).mockImplementation(async (noteId) =>
      noteId === 1 ? [attachment(1, "first.txt")] : [attachment(2, "second.txt")],
    );
    const { rerender } = render(<AttachmentsPanel key={1} noteId={1} />);
    expect(await screen.findByText("first.txt")).toBeTruthy();

    rerender(<AttachmentsPanel key={2} noteId={2} />);

    expect(await screen.findByText("second.txt")).toBeTruthy();
    expect(screen.queryByText("first.txt")).toBeNull();
  });
});
