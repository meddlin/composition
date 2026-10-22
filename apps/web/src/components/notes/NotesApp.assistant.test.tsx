// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "@/lib/composition/assistantClient";
import { createNote, listAssistantModels, saveNoteContent } from "@/lib/composition/client";
import * as frontmatter from "@/lib/composition/frontmatter";
import { DEFAULT_LAYOUT } from "@/lib/composition/layout";
import { NotesApp } from "./NotesApp";
import type { Group, Note } from "./types";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => []),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));
vi.mock("@/lib/composition/client", () => ({
  createGroup: vi.fn(), createNote: vi.fn(), deleteGroup: vi.fn(), deleteNote: vi.fn(), moveGroup: vi.fn(),
  moveNoteToGroup: vi.fn(), renameGroup: vi.fn(), saveLayout: vi.fn(), saveNoteContent: vi.fn(),
  searchNotes: vi.fn(async () => ({ hits: [] })), listAssistantModels: vi.fn(),
}));
vi.mock("@/lib/composition/assistantClient", () => ({ streamChat: vi.fn() }));

const at = "2026-01-01T00:00:00.000Z";
const source: Note = {
  id: 1, title: "Trip", tags: "", description: "", createdAt: at, updatedAt: at, groupId: 7,
  content: frontmatter.generate("Trip", { createdAt: at, updatedAt: at }) + "Day one: Alfama.\n",
};
const group: Group = { id: 7, name: "Travel", parentId: null, createdAt: at, updatedAt: at } as Group;

beforeEach(() => {
  vi.mocked(listAssistantModels).mockResolvedValue({
    serverUrl: "http://127.0.0.1:11434", local: true, contextTokens: 8192, hiddenCloud: 0,
    models: [{ name: "qwen3:0.6b", parameterSize: "751M", contextLength: 40960, capabilities: ["completion"] }],
  });
  vi.mocked(streamChat).mockImplementation(async function* () {
    yield { type: "delta", text: "# Day two ideas\n\nVisit Sintra." };
    yield { type: "done" };
  });
  vi.mocked(createNote).mockImplementation(async (title, groupId) => ({
    id: 2, title, tags: "", description: "", createdAt: at, updatedAt: at, groupId: groupId ?? null,
    content: frontmatter.generate(title, { createdAt: at, updatedAt: at }),
  }));
  vi.mocked(saveNoteContent).mockImplementation(async (id, content) => ({
    id, title: "Day two ideas", tags: "", description: "", createdAt: at, updatedAt: at, groupId: 7, content,
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pane = (title: string) => screen.getByRole("region", { name: title });

async function askAndMakeNote() {
  render(<NotesApp initialNotes={[source]} initialGroups={[group]} initialLayout={DEFAULT_LAYOUT} />);
  fireEvent.click(within(pane("Trip")).getByRole("button", { name: "AI helper" }));
  await screen.findByRole("option", { name: /qwen3/ });
  const box = screen.getByLabelText("Ask about this note");
  fireEvent.change(box, { target: { value: "ideas for day two?" } });
  await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
  fireEvent.click(await screen.findByRole("button", { name: "New note from this" }));
}

describe("making a note from an AI helper answer", () => {
  it("creates a separate note in the same group, titled and filled from the answer, and opens it to the right", async () => {
    await askAndMakeNote();

    await screen.findByRole("region", { name: "Day two ideas" });
    expect(createNote).toHaveBeenCalledWith("Day two ideas", 7);
    const [id, content] = vi.mocked(saveNoteContent).mock.calls[0];
    expect(id).toBe(2);
    const [fm, body] = frontmatter.parse(content);
    expect(fm?.title).toBe("Day two ideas");
    expect(body).toBe("# Day two ideas\n\nVisit Sintra.\n");
    // Opened beside the note it came from, on its right.
    const titles = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")).filter((name) => name === "Trip" || name === "Day two ideas");
    expect(titles).toEqual(["Trip", "Day two ideas"]);
  });

  it("leaves the note the answer was about untouched", async () => {
    await askAndMakeNote();
    await screen.findByRole("region", { name: "Day two ideas" });

    // Nothing was saved to note 1, and its editor still holds exactly what it did.
    expect(vi.mocked(saveNoteContent).mock.calls.every(([id]) => id !== 1)).toBe(true);
    expect((within(pane("Trip")).getByLabelText("Markdown editor") as HTMLTextAreaElement).value).toBe(source.content);
  });
});
