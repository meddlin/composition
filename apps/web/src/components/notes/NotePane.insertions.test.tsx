// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertIntoOpenNote } from "./noteInsertions";
import { NotePane } from "./NotePane";
import type { Note } from "./types";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => []),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));
vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const note: Note = { id: 41, title: "Chapter", content: "---\ntitle: Chapter\n---\nhello", tags: "", description: "", createdAt: "x", updatedAt: "x", groupId: null, notebookId: 1 };

afterEach(cleanup);

function Pane({ shown = note, deleted = false }: { shown?: Note; deleted?: boolean }) {
  const [content, setContent] = useState(shown.content);
  return (
    <NotePane
      note={{ ...shown, content }}
      focused
      view="markdown"
      ratio={0.5}
      onRatioChange={() => {}}
      onRatioCommit={() => {}}
      onViewChange={() => {}}
      onFocus={() => {}}
      onClose={() => {}}
      onChange={setContent}
      onDropNote={() => {}}
      notes={[shown]}
      onOpenNote={() => {}}
      onNewNoteFromText={() => {}}
      panel={deleted ? { panelId: "p1", deleted: true, actions: null, onDropNote: () => {}, onDropPanel: () => {}, onOpenAssistant: () => {} } : undefined}
    />
  );
}

describe("a note pane that takes Markdown from outside", () => {
  it("is where the PDF reader's quote goes, while it is open", () => {
    render(<Pane />);

    let taken = false;
    act(() => {
      taken = insertIntoOpenNote(41, "> quote", "block");
    });

    expect(taken).toBe(true);
    expect(screen.getByLabelText<HTMLTextAreaElement>("Markdown editor").value).toBe("---\ntitle: Chapter\n---\nhello\n\n> quote\n\n");
  });

  it("is no longer there to take it once it is closed", () => {
    const { unmount } = render(<Pane />);

    unmount();

    expect(insertIntoOpenNote(41, "> quote", "block")).toBe(false);
  });

  it("takes nothing when the note was deleted while it is on screen", () => {
    render(<Pane deleted />);

    expect(insertIntoOpenNote(41, "> quote", "block")).toBe(false);
  });
});
