// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatsStore } from "@/lib/composition/assistant/chatsStore";
import { streamChat } from "@/lib/composition/assistantClient";
import { listAssistantModels } from "@/lib/composition/client";
import type { ChatEvent } from "@/lib/composition/assistant/types";
import { DEFAULT_LAYOUT } from "@/lib/composition/layout";
import { NotesApp } from "./NotesApp";
import { openNoteBeside } from "./panes";
import type { Note } from "./types";
import { createWorkspaceStore, type WorkspaceDeps } from "./workspaceStore";

vi.mock("@/lib/composition/attachmentsClient", () => ({
  attachmentCapabilities: { canReveal: false, saveCopyTitle: "Download", saveCopyLabel: (n: string) => `Download ${n}` },
  listAttachments: vi.fn(async () => []),
  addAttachments: vi.fn(),
  revealAttachment: vi.fn(),
  saveAttachmentCopy: vi.fn(),
  removeAttachment: vi.fn(),
}));
vi.mock("@/lib/composition/client", () => ({ saveLayout: vi.fn(), searchNotes: vi.fn(async () => ({ hits: [] })), listAssistantModels: vi.fn() }));
vi.mock("@/lib/composition/assistantClient", () => ({ streamChat: vi.fn() }));

const at = "2026-01-01T00:00:00.000Z";
const makeNote = (id: number, title: string): Note => ({
  id,
  title,
  content: `body of ${title}`,
  tags: "",
  description: "",
  createdAt: at,
  updatedAt: at,
  groupId: null,
  notebookId: 1,
});

afterEach(cleanup);

/** A workspace kept from an earlier visit, as the desktop app keeps one while the user is in Settings. */
function keptWorkspace() {
  const deps = { saveNoteContent: vi.fn(async (id: number, content: string) => ({ ...makeNote(id, `Note ${id}`), content })) } as unknown as WorkspaceDeps;
  const streams: AbortSignal[] = [];
  const assistant = createChatsStore({
    async *streamChat(_request, signal): AsyncGenerator<ChatEvent> {
      streams.push(signal);
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
    },
  });
  const store = createWorkspaceStore({ notes: [makeNote(1, "Alpha"), makeNote(2, "Beta")], groups: [] }, deps, assistant);
  store.updatePanes((panes) => openNoteBeside(panes, 2));
  return { store, deps, streams };
}

const renderKept = (store: ReturnType<typeof keptWorkspace>["store"]) =>
  render(<NotesApp store={store} initialNotes={[]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);
const paneRegions = () => screen.queryAllByRole("region").filter((r) => r.hasAttribute("aria-label")).map((r) => r.getAttribute("aria-label"));

describe("NotesApp on a workspace kept from an earlier visit", () => {
  it("opens with the panes it had, after the screen was left and came back", () => {
    const { store } = keptWorkspace();

    renderKept(store).unmount();
    renderKept(store);

    expect(paneRegions()).toEqual(["Alpha", "Beta"]);
  });

  it("sends the text typed just before leaving, since nothing will unmount it later", () => {
    const { store, deps } = keptWorkspace();
    renderKept(store);
    store.editNote(1, "typed just before leaving");

    cleanup();

    expect(deps.saveNoteContent).toHaveBeenCalledWith(1, "typed just before leaving");
  });

  it("does not cut off an AI answer that is still streaming when the screen goes away", async () => {
    const { store, streams } = keptWorkspace();
    renderKept(store);
    store.assistant.send({ noteId: 1, noteContent: "body", userText: "Hi?", model: "m", numCtx: 4096 });
    await vi.waitFor(() => expect(streams).toHaveLength(1));

    cleanup();

    expect(streams[0].aborted).toBe(false);
  });
});

describe("NotesApp on a workspace it made itself", () => {
  it("cuts off an AI answer that is still streaming when the screen goes away", async () => {
    vi.mocked(listAssistantModels).mockResolvedValue({
      serverUrl: "http://127.0.0.1:11434", local: true, contextTokens: 8192, hiddenCloud: 0,
      models: [{ name: "qwen3:0.6b", parameterSize: "751M", contextLength: 40960, capabilities: ["completion"] }],
    });
    const signals: AbortSignal[] = [];
    vi.mocked(streamChat).mockImplementation(async function* (_request, signal) {
      signals.push(signal!);
      await new Promise((resolve) => signal!.addEventListener("abort", resolve));
    });
    render(<NotesApp initialNotes={[makeNote(1, "Alpha")]} initialGroups={[]} initialLayout={DEFAULT_LAYOUT} />);
    fireEvent.click(within(screen.getByRole("region", { name: "Alpha" })).getByRole("button", { name: "AI helper" }));
    await screen.findByRole("option", { name: /qwen3/ });
    const box = screen.getByLabelText("Ask about this note");
    fireEvent.change(box, { target: { value: "what next?" } });
    await act(async () => void fireEvent.keyDown(box, { key: "Enter" }));
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    cleanup();

    expect(signals[0].aborted).toBe(true);
  });
});
