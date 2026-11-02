// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatGptStatus } from "@/lib/composition/assistant/types";
import { chatGptStatus, signOutChatGpt, startChatGptSignIn } from "@/lib/composition/client";
import { ChatGptSettings } from "./ChatGptSettings";

vi.mock("@/lib/composition/client", () => ({
  chatGptStatus: vi.fn(),
  startChatGptSignIn: vi.fn(),
  signOutChatGpt: vi.fn(),
}));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const status = (...answers: ChatGptStatus[]) => {
  const queue = [...answers];
  vi.mocked(chatGptStatus).mockImplementation(async () => (queue.length > 1 ? queue.shift()! : queue[0]));
};

const renderIt = async () => {
  render(<ChatGptSettings />);
  await act(async () => {});
};

describe("ChatGptSettings", () => {
  it("offers to sign in when signed out, and says where the notes go", async () => {
    status({ state: "signed-out" });
    await renderIt();
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
    expect(screen.getByText(/sends the note you are in/i)).toBeTruthy();
  });

  it("starts the sign-in, waits while the browser is open, then shows the account", async () => {
    status({ state: "signed-out" }, { state: "pending" }, { state: "pending" }, { state: "signed-in", email: "me@example.com" });
    vi.mocked(startChatGptSignIn).mockResolvedValue({});
    await renderIt();

    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" })));
    expect(startChatGptSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/waiting for you to approve/i)).toBeTruthy();

    await act(async () => void (await vi.advanceTimersByTimeAsync(1600)));
    await act(async () => void (await vi.advanceTimersByTimeAsync(1600)));
    expect(screen.getByRole("status").textContent).toMatch(/Signed in as me@example\.com/);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("shows why the browser could not be opened", async () => {
    status({ state: "signed-out" });
    vi.mocked(startChatGptSignIn).mockResolvedValue({ error: "Couldn't open your browser. Open this address yourself to sign in: https://x" });
    await renderIt();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't open your browser/);
  });

  it("shows why the last sign-in failed", async () => {
    status({ state: "signed-out", error: "Sign-in was cancelled." });
    await renderIt();
    expect(screen.getByRole("alert").textContent).toBe("Sign-in was cancelled.");
  });

  it("signs out", async () => {
    status({ state: "signed-in", email: "me@example.com" }, { state: "signed-out" });
    vi.mocked(signOutChatGpt).mockResolvedValue({});
    await renderIt();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Sign out" })));
    expect(signOutChatGpt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
  });

  it("cancels a sign-in that is waiting", async () => {
    status({ state: "pending" }, { state: "signed-out" });
    vi.mocked(signOutChatGpt).mockResolvedValue({});
    await renderIt();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(signOutChatGpt).toHaveBeenCalledTimes(1);
  });
});
