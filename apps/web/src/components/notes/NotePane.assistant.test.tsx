// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "@/lib/composition/assistantClient";
import { listAssistantModels } from "@/lib/composition/client";
import { AssistantProvider } from "./AssistantProvider";
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
vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn(), listAssistantModels: vi.fn() }));
vi.mock("@/lib/composition/assistantClient", () => ({ streamChat: vi.fn() }));

const note: Note = {
  id: 1, title: "Trip plan", content: "Day one: Alfama.", tags: "", description: "",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", groupId: null,
};

beforeEach(() => {
  vi.mocked(listAssistantModels).mockResolvedValue({
    serverUrl: "http://127.0.0.1:11434", local: true, contextTokens: 8192, hiddenCloud: 0,
    models: [{ name: "qwen3:0.6b", parameterSize: "751M", contextLength: 40960, capabilities: ["completion"] }],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPane(over: { focused?: boolean; onNewNoteFromText?: (text: string) => void; view?: "split" | "markdown" | "preview" } = {}) {
  const onNewNoteFromText = over.onNewNoteFromText ?? vi.fn();
  render(
    <AssistantProvider>
      <NotePane
        note={note}
        focused={over.focused ?? true}
        view={over.view ?? "split"}
        ratio={0.5}
        onRatioChange={() => {}}
        onRatioCommit={() => {}}
        onViewChange={() => {}}
        onFocus={() => {}}
        onClose={() => {}}
        onChange={() => {}}
        onDropNote={() => {}}
        notes={[note]}
        onOpenNote={() => {}}
        onNewNoteFromText={onNewNoteFromText}
      />
    </AssistantProvider>,
  );
  return { onNewNoteFromText };
}

const toggle = () => screen.getByRole("button", { name: "AI helper" });
const panel = () => screen.queryByRole("complementary", { name: "AI helper" });

describe("the AI helper dock in a note pane", () => {
  it("is closed to begin with, and asks Ollama nothing until it is opened", () => {
    renderPane();
    expect(panel()).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(listAssistantModels).not.toHaveBeenCalled();
  });

  it("opens beside the note from the header button, and closes again", async () => {
    renderPane();

    fireEvent.click(toggle());
    expect(panel()).toBeTruthy();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    await screen.findByRole("option", { name: /qwen3/ });
    // The editor is still there, beside it.
    expect(screen.getByLabelText("Markdown editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close AI helper" }));
    expect(panel()).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("opens with Ctrl+Shift+L, and puts the cursor in the question box", async () => {
    renderPane();
    fireEvent.keyDown(document, { key: "L", ctrlKey: true, shiftKey: true });
    expect(panel()).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Ask about this note")));

    fireEvent.keyDown(document, { key: "L", ctrlKey: true, shiftKey: true });
    expect(panel()).toBeNull();
  });

  it("answers the shortcut only in the focused pane", () => {
    renderPane({ focused: false });
    fireEvent.keyDown(document, { key: "L", metaKey: true, shiftKey: true });
    expect(panel()).toBeNull();
  });

  it("announces the shortcut on its button", () => {
    renderPane();
    expect(toggle().getAttribute("aria-keyshortcuts")).toBe("Control+Shift+L Meta+Shift+L");
  });

  it("gives the note's text to the panel as it is being typed, and passes a new-note request up", async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: "delta", text: "# Ideas\n\nGo." };
      yield { type: "done" };
    });
    const { onNewNoteFromText } = renderPane();
    fireEvent.click(toggle());
    await screen.findByRole("option", { name: /qwen3/ });
    fireEvent.change(screen.getByLabelText("Ask about this note"), { target: { value: "ideas?" } });
    await act(async () => void fireEvent.keyDown(screen.getByLabelText("Ask about this note"), { key: "Enter" }));
    expect(vi.mocked(streamChat).mock.calls[0][0].messages[0].content).toContain("Day one: Alfama.");

    fireEvent.click(await screen.findByRole("button", { name: "New note from this" }));
    expect(onNewNoteFromText).toHaveBeenCalledWith("# Ideas\n\nGo.");
  });

  it("reads the editor's selection when focus moves into the panel", async () => {
    vi.mocked(streamChat).mockImplementation(async function* () { yield { type: "done" }; });
    renderPane({ view: "markdown" });
    const editor = document.querySelector("textarea")!;
    editor.setSelectionRange(0, 8); // "Day one:"
    fireEvent.click(toggle());
    await screen.findByRole("option", { name: /qwen3/ });

    fireEvent.focus(screen.getByLabelText("Ask about this note"));

    expect(screen.getByText(/Selection \(8 characters\)/)).toBeTruthy();
  });
});
