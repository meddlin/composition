// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantModels } from "@/lib/composition/api";
import type { ChatEvent, ChatRequest } from "@/lib/composition/assistant/types";
import { streamChat } from "@/lib/composition/assistantClient";
import { listAssistantModels } from "@/lib/composition/client";
import { AssistantPanel } from "./AssistantPanel";
import { AssistantProvider } from "./AssistantProvider";
import { copyText } from "./clipboard";

vi.mock("@/lib/composition/client", () => ({ listAssistantModels: vi.fn() }));
vi.mock("@/lib/composition/assistantClient", () => ({ streamChat: vi.fn() }));
vi.mock("./clipboard", () => ({ copyText: vi.fn(async () => true) }));

beforeEach(() => {
  try { localStorage.clear(); } catch { /* no storage here */ }
  vi.mocked(listAssistantModels).mockResolvedValue(models());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function models(over: Partial<AssistantModels> = {}): AssistantModels {
  return {
    serverUrl: "http://127.0.0.1:11434",
    local: true,
    contextTokens: 8192,
    hiddenCloud: 0,
    models: [
      { name: "qwen3:0.6b", parameterSize: "751.63M", contextLength: 40960, capabilities: ["completion", "thinking"] },
      { name: "llama3.1:8b", parameterSize: "8.0B", contextLength: 131072, capabilities: ["completion"] },
    ],
    ...over,
  };
}

/** Streams of events the test scripts: each call to streamChat takes the next script. */
function script(...turns: ChatEvent[][]) {
  const requests: ChatRequest[] = [];
  const queue = [...turns];
  vi.mocked(streamChat).mockImplementation(async function* (request) {
    requests.push(request);
    yield* queue.shift() ?? [];
  });
  return requests;
}

/** A stream that never ends by itself, and ends with an aborted event when stopped. */
function endless(first: ChatEvent) {
  vi.mocked(streamChat).mockImplementation(async function* (_request, signal) {
    yield first;
    await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
    yield { type: "error", kind: "aborted", message: "Stopped." };
  });
}

const NOTE = "---\ntitle: Trip\n---\nDay one.\n";

function renderPanel(over: Partial<Parameters<typeof AssistantPanel>[0]> = {}) {
  const props = {
    noteId: 1,
    noteContent: NOTE,
    getSelection: () => "",
    onNewNoteFromText: vi.fn(),
    onClose: vi.fn(),
    onReturnFocus: vi.fn(),
    ...over,
  };
  render(
    <AssistantProvider>
      <AssistantPanel {...props} />
    </AssistantProvider>,
  );
  return props;
}

const composer = () => screen.getByLabelText("Ask about this note") as HTMLTextAreaElement;
const ready = () => screen.findByRole("option", { name: /qwen3:0\.6b/ });
async function ask(text: string) {
  await ready();
  fireEvent.change(composer(), { target: { value: text } });
  await act(async () => void fireEvent.keyDown(composer(), { key: "Enter" }));
}

describe("AssistantPanel", () => {
  it("lists the models, says where the note goes, and answers a question as it streams", async () => {
    const requests = script([{ type: "delta", text: "Try " }, { type: "delta", text: "Sintra." }, { type: "done" }]);
    renderPanel();

    await ready();
    expect(screen.getByText(/this computer/i)).toBeTruthy();
    await ask("What next?");

    expect(await screen.findByText("Try Sintra.")).toBeTruthy();
    expect(screen.getByText("What next?")).toBeTruthy();
    expect(requests[0]).toMatchObject({ model: "qwen3:0.6b", numCtx: 8192 });
    expect(requests[0].messages.at(-1)).toEqual({ role: "user", content: "What next?" });
    expect(composer().value).toBe("");
  });

  it("names the server when it is not this computer", async () => {
    vi.mocked(listAssistantModels).mockResolvedValue(models({ serverUrl: "http://nas.local:11434", local: false }));
    renderPanel();
    await ready();
    expect(screen.getByText(/nas\.local/)).toBeTruthy();
  });

  it("asks the model that was picked, and remembers the choice", async () => {
    const requests = script([{ type: "done" }]);
    renderPanel();
    await ready();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "llama3.1:8b" } });
    await ask("hi");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].model).toBe("llama3.1:8b");
    expect(localStorage.getItem("composition.assistant.model")).toBe("llama3.1:8b");
  });

  it("Enter sends, Shift+Enter and an Enter that confirms an IME composition do not", async () => {
    script([{ type: "done" }]);
    renderPanel();
    await ready();
    fireEvent.change(composer(), { target: { value: "hello" } });

    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(composer(), { key: "Enter", isComposing: true });
    expect(streamChat).not.toHaveBeenCalled();

    await act(async () => void fireEvent.keyDown(composer(), { key: "Enter" }));
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it("does not send an empty question", async () => {
    renderPanel();
    await ready();
    await act(async () => void fireEvent.keyDown(composer(), { key: "Enter" }));
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("shows a Stop button while an answer streams, and stopping keeps what had arrived", async () => {
    endless({ type: "delta", text: "Half an ans" });
    renderPanel();
    await ask("go");

    expect(await screen.findByText("Half an ans")).toBeTruthy();
    expect(screen.getByRole("log").getAttribute("aria-busy")).toBe("true");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop" })));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Stop" })).toBeNull());
    expect(screen.getByText("Half an ans")).toBeTruthy();
    expect(screen.getByText("Stopped.")).toBeTruthy();
  });

  it("says the model is thinking until its answer starts", async () => {
    endless({ type: "thinking" });
    renderPanel();
    await ask("go");
    expect(await screen.findByText(/thinking/i)).toBeTruthy();
  });

  it("copies an answer, and makes a new note from it, on request", async () => {
    script([{ type: "delta", text: "# Plan\n\nDo it." }, { type: "done" }]);
    const props = renderPanel();
    await ask("plan?");
    await screen.findByText("Plan");

    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Copy" })));
    expect(copyText).toHaveBeenCalledWith("# Plan\n\nDo it.");

    fireEvent.click(screen.getByRole("button", { name: "New note from this" }));
    expect(props.onNewNoteFromText).toHaveBeenCalledWith("# Plan\n\nDo it.");
  });

  it("offers no way to put an answer into the note: the panel is given the note to read, never to change", () => {
    // Compile-time: passing `onChange` (or any writer) is an error, checked by `tsc`.
    const element = (
      <AssistantPanel
        noteId={1}
        noteContent=""
        getSelection={() => ""}
        onNewNoteFromText={() => {}}
        onClose={() => {}}
        onReturnFocus={() => {}}
        // @ts-expect-error the panel has no `onChange`
        onChange={() => {}}
      />
    );
    expect(element).toBeTruthy();
  });

  describe("selection", () => {
    it("takes the pane's selection when focus enters the panel, shows it as a chip, and sends it once", async () => {
      const requests = script([{ type: "done" }], [{ type: "done" }]);
      renderPanel({ getSelection: () => "Day one." });
      await ready();

      fireEvent.focus(composer());
      expect(screen.getByText(/Selection \(8 characters\)/)).toBeTruthy();
      await ask("Rewrite this");
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].messages.at(-1)?.content).toContain("Day one.");
      expect(screen.queryByText(/Selection \(/)).toBeNull();

      await ask("And again");
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1].messages.at(-1)?.content).toBe("And again");
    });

    it("lets the user drop the selection before sending", async () => {
      const requests = script([{ type: "done" }]);
      renderPanel({ getSelection: () => "Day one." });
      await ready();
      fireEvent.focus(composer());

      fireEvent.click(screen.getByRole("button", { name: "Remove the selection" }));
      expect(screen.queryByText(/Selection \(/)).toBeNull();
      await ask("hi");
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].messages.at(-1)?.content).toBe("hi");
    });
  });

  describe("the size of what is sent", () => {
    it("says roughly how large the note is", async () => {
      renderPanel();
      await ready();
      expect(screen.getByText(/Sends this note \(about \d+ tokens\)/)).toBeTruthy();
    });

    it("warns when the prompt nearly fills the window", async () => {
      vi.mocked(listAssistantModels).mockResolvedValue(models({ contextTokens: 1024 }));
      renderPanel({ noteContent: "x".repeat(3300) });
      await ready();
      expect(screen.getByText(/nearly fills/i)).toBeTruthy();
    });

    it("will not send what cannot fit, and says how to fix it", async () => {
      vi.mocked(listAssistantModels).mockResolvedValue(models({ contextTokens: 1024 }));
      renderPanel({ noteContent: "x".repeat(8000) });
      await ready();
      fireEvent.change(composer(), { target: { value: "hi" } });

      expect(screen.getByText(/too large/i).textContent).toMatch(/Settings|select/);
      await act(async () => void fireEvent.keyDown(composer(), { key: "Enter" }));
      expect(streamChat).not.toHaveBeenCalled();
    });

    it("uses the model's own limit when it is smaller than the setting", async () => {
      vi.mocked(listAssistantModels).mockResolvedValue(
        models({ contextTokens: 32768, models: [{ name: "tiny:1b", parameterSize: "1B", contextLength: 2048, capabilities: ["completion"] }] }),
      );
      const requests = script([{ type: "done" }]);
      renderPanel();
      await screen.findByRole("option", { name: /tiny:1b/ });
      fireEvent.change(composer(), { target: { value: "hi" } });
      await act(async () => void fireEvent.keyDown(composer(), { key: "Enter" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].numCtx).toBe(2048);
    });

    it("warns when the server says it dropped part of the conversation", async () => {
      script([{ type: "delta", text: "ok" }, { type: "usage", promptTokens: 3, outputTokens: 1 }, { type: "done" }]);
      renderPanel({ noteContent: "x".repeat(4000) });
      await ask("hi");
      expect(await screen.findByText(/only read part/i)).toBeTruthy();
    });
  });

  describe("when there is nothing to chat with", () => {
    it("says Ollama can't be reached, with the reason, a way to check again and a way to Settings", async () => {
      vi.mocked(listAssistantModels).mockResolvedValue(
        models({ models: [], error: { kind: "unreachable", message: "Can't reach Ollama at http://127.0.0.1:11434. Is it running?" } }),
      );
      renderPanel();
      expect((await screen.findByRole("alert")).textContent).toContain("Can't reach Ollama");
      expect(screen.getByRole("link", { name: /Settings/ }).getAttribute("href")).toBe("/settings");

      vi.mocked(listAssistantModels).mockResolvedValue(models());
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
      await ready();
    });

    it("says how to get a model when the server has none", async () => {
      vi.mocked(listAssistantModels).mockResolvedValue(models({ models: [] }));
      renderPanel();
      expect((await screen.findByText(/no models/i)).textContent).toContain("ollama pull");
      expect(composer().disabled).toBe(true);
    });

    it("explains that cloud models are hidden when they are all there is", async () => {
      vi.mocked(listAssistantModels).mockResolvedValue(models({ models: [], hiddenCloud: 2 }));
      renderPanel();
      expect((await screen.findByText(/ollama\.com/i)).textContent).toMatch(/hidden|left out/i);
    });

    it("reports a failed answer in the conversation, with the reason", async () => {
      script([{ type: "error", kind: "model-missing", message: 'The model "qwen3:0.6b" isn\'t installed on this server. Install it with: ollama pull qwen3:0.6b' }]);
      renderPanel();
      await ask("hi");
      expect((await screen.findByRole("alert")).textContent).toContain("ollama pull qwen3:0.6b");
    });
  });

  describe("chats", () => {
    it("starts a new chat, keeps the old one, and switches back", async () => {
      script([{ type: "delta", text: "first answer" }, { type: "done" }], [{ type: "delta", text: "second answer" }, { type: "done" }]);
      renderPanel();
      await ask("one");
      await screen.findByText("first answer");

      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
      expect(screen.queryByText("first answer")).toBeNull();
      await ask("two");
      await screen.findByText("second answer");

      const switcher = screen.getByLabelText("Chat") as HTMLSelectElement;
      expect(switcher.options).toHaveLength(2);
      expect(switcher.options[0].textContent).toContain("one");
      fireEvent.change(switcher, { target: { value: switcher.options[0].value } });
      expect(screen.getByText("first answer")).toBeTruthy();
      expect(screen.queryByText("second answer")).toBeNull();
    });
  });

  it("closes, and gives focus back to the note on Escape", async () => {
    const props = renderPanel();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Close AI helper" }));
    expect(props.onClose).toHaveBeenCalled();
    fireEvent.keyDown(composer(), { key: "Escape" });
    expect(props.onReturnFocus).toHaveBeenCalled();
  });
});
