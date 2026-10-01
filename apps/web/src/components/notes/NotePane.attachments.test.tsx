// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentsSlot as WebSlot } from "./AttachmentsSlot";
import { NotePane } from "./NotePane";
import type { Note } from "./types";

// The web build resolves AttachmentsSlot.tsx (nothing); the desktop build resolves
// AttachmentsSlot.desktop.tsx (the panel). This flips NotePane between the two.
const slot = vi.hoisted(() => ({ desktop: false }));

vi.mock("./AttachmentsSlot", async () => {
  const web = await vi.importActual<typeof import("./AttachmentsSlot")>("./AttachmentsSlot");
  const desktop = await vi.importActual<typeof import("./AttachmentsSlot.desktop")>("./AttachmentsSlot.desktop");
  return { AttachmentsSlot: (props: { noteId: number }) => (slot.desktop ? desktop : web).AttachmentsSlot(props) };
});

vi.mock("@/lib/composition/attachmentsClient", () => ({
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

function renderPane() {
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
}

afterEach(() => {
  cleanup();
  slot.desktop = false;
});

describe("attachments in a note pane", () => {
  it("renders nothing in the web build", () => {
    expect(WebSlot({ noteId: 1 })).toBeNull();

    renderPane();

    expect(screen.queryByRole("button", { name: "Attach files" })).toBeNull();
    expect(screen.queryByText("Attachments")).toBeNull();
  });

  it("lists the note's attachments below the editor in the desktop build", async () => {
    slot.desktop = true;
    renderPane();

    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.getByText("itinerary.pdf")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
  });
});
