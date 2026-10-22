// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantModels } from "@/lib/composition/api";
import { listAssistantModels, saveAssistantSettings } from "@/lib/composition/client";
import { AssistantSettings } from "./AssistantSettings";

vi.mock("@/lib/composition/client", () => ({
  saveAssistantSettings: vi.fn(),
  listAssistantModels: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const saved = { serverUrl: "http://127.0.0.1:11434", contextTokens: 8192 };

const found = (overrides: Partial<AssistantModels> = {}): AssistantModels => ({
  serverUrl: "http://127.0.0.1:11434",
  local: true,
  contextTokens: 8192,
  hiddenCloud: 0,
  models: [
    { name: "qwen3:0.6b", parameterSize: "751.63M", contextLength: 40960, capabilities: ["completion"] },
    { name: "llama3.1:8b", parameterSize: "8.0B", contextLength: 131072, capabilities: ["completion"] },
  ],
  ...overrides,
});

function renderIt(initial = saved) {
  render(<AssistantSettings initial={initial} />);
}

const address = () => screen.getByLabelText("Server address") as HTMLInputElement;
const windowSize = () => screen.getByLabelText("Context size (tokens)") as HTMLInputElement;
const click = (name: string) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));
const type = (input: HTMLInputElement, value: string) => act(async () => void fireEvent.change(input, { target: { value } }));

describe("AssistantSettings", () => {
  it("shows the saved server and context size, and says that cloud models are hidden", () => {
    renderIt({ serverUrl: "http://nas:11434", contextTokens: 16384 });

    expect(screen.getByRole("heading", { name: "AI helper" })).toBeTruthy();
    expect(address().value).toBe("http://nas:11434");
    expect(windowSize().value).toBe("16384");
    expect(screen.getByText(/run on ollama\.com are hidden/i)).toBeTruthy();
  });

  it("saves what was entered, then checks the connection and names the models it found", async () => {
    vi.mocked(saveAssistantSettings).mockResolvedValue({ settings: { serverUrl: "http://nas:11434", contextTokens: 16384 } });
    vi.mocked(listAssistantModels).mockResolvedValue(found({ serverUrl: "http://nas:11434", local: false }));
    renderIt();

    await type(address(), "nas:11434");
    await type(windowSize(), "16384");
    await click("Save");

    expect(saveAssistantSettings).toHaveBeenCalledWith({ serverUrl: "nas:11434", contextTokens: 16384 });
    expect(listAssistantModels).toHaveBeenCalledTimes(1);
    const status = screen.getByRole("status").textContent ?? "";
    expect(status).toContain("Saved.");
    expect(status).toContain("Found 2 models on http://nas:11434");
    expect(status).toContain("qwen3:0.6b (751.63M)");
    expect(status).toContain("llama3.1:8b (8.0B)");
    // The field now shows the address as it was saved.
    expect(address().value).toBe("http://nas:11434");
  });

  it("says what is wrong with the settings, and does not go on to the connection", async () => {
    vi.mocked(saveAssistantSettings).mockResolvedValue({ error: "Port 22 can't be used: web requests to it are blocked." });
    renderIt();

    await type(address(), "http://nas:22");
    await click("Save");

    expect(screen.getByRole("alert").textContent).toContain("Port 22 can't be used");
    expect(listAssistantModels).not.toHaveBeenCalled();
  });

  it("says that the settings are saved even when the server can't be reached", async () => {
    vi.mocked(saveAssistantSettings).mockResolvedValue({ settings: saved });
    vi.mocked(listAssistantModels).mockResolvedValue(
      found({ models: [], error: { kind: "unreachable", message: "Can't reach Ollama at http://127.0.0.1:11434. Is it running?" } }),
    );
    renderIt();

    await click("Save");

    expect(screen.getByRole("status").textContent).toContain("Saved.");
    expect(screen.getByRole("alert").textContent).toContain("Can't reach Ollama at http://127.0.0.1:11434. Is it running?");
  });

  it("says when the server is reachable but has nothing to chat with, and how many cloud models it left out", async () => {
    vi.mocked(listAssistantModels).mockResolvedValue(found({ models: [], hiddenCloud: 2 }));
    renderIt();

    await click("Test connection");

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/no models/i);
    expect(text).toContain("ollama pull");
    expect(text).toMatch(/2 models that run on ollama\.com were left out/i);
  });

  it("uses the singular for one model", async () => {
    vi.mocked(listAssistantModels).mockResolvedValue(found({ models: found().models.slice(0, 1), hiddenCloud: 1 }));
    renderIt();

    await click("Test connection");

    expect(screen.getByRole("status").textContent).toContain("Found 1 model on");
    expect(document.body.textContent).toMatch(/1 model that runs on ollama\.com was left out/i);
  });

  it("tests the saved server without saving, and not while there are unsaved edits", async () => {
    vi.mocked(listAssistantModels).mockResolvedValue(found());
    renderIt();

    await click("Test connection");
    expect(saveAssistantSettings).not.toHaveBeenCalled();
    expect(listAssistantModels).toHaveBeenCalledTimes(1);

    await type(address(), "http://other:11434");
    expect((screen.getByRole("button", { name: "Test connection" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops showing the last result as soon as a field is edited, since it is about what was saved", async () => {
    vi.mocked(saveAssistantSettings).mockResolvedValue({ settings: saved });
    vi.mocked(listAssistantModels).mockResolvedValue(found());
    renderIt();
    await click("Save");
    expect(screen.getByRole("status").textContent).toContain("Found 2 models");

    await type(windowSize(), "16384");

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears an old complaint when the field it was about is edited", async () => {
    vi.mocked(saveAssistantSettings).mockResolvedValue({ error: "Port 22 can't be used." });
    renderIt();
    await type(address(), "http://nas:22");
    await click("Save");
    expect(screen.getByRole("alert")).toBeTruthy();

    await type(address(), "http://nas:11434");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["http://192.168.1.5:11434", true],
    ["nas:11434", true],
    ["http://127.0.0.1:11434", false],
    ["localhost:11434", false],
    ["https://ollama.example.com", false],
    ["", false],
  ])("warns that notes cross the network unencrypted for %j: %s", async (typed, warned) => {
    renderIt();

    await type(address(), typed);

    expect(Boolean(screen.queryByText(/unencrypted/i))).toBe(warned);
  });
});
