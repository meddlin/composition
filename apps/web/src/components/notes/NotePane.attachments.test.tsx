// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotePane } from "./NotePane";
import type { Note } from "./types";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => [
    { id: 1, noteId: 1, fileName: "itinerary.pdf", size: 2048, createdAt: "2026-03-04T12:00:00.000Z" },
  ]),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const note: Note = {
  id: 1,
  title: "Trip plan",
  content: "hello",
  tags: "",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
};

afterEach(cleanup);

describe("attachments in a note pane", () => {
  it("lists the note's attachments below the editor", async () => {
    render(
      <NotePane
        note={note}
        focused
        view="split"
        ratio={0.5}
        onRatioChange={() => {}}
        onRatioCommit={() => {}}
        onViewChange={() => {}}
        onFocus={() => {}}
        onClose={() => {}}
        onChange={() => {}}
        onDropNote={() => {}}
      />,
    );

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByText("itinerary.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
  });
});
