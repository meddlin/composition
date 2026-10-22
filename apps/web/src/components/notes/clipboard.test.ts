// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { execCommand?: unknown }).execCommand;
});

describe("copyText", () => {
  it("writes to the clipboard and says it worked", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to the browser's copy command when the clipboard API is refused", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    const execCommand = vi.fn(() => true);
    Object.assign(document, { execCommand });
    expect(await copyText("hello")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("says so when nothing could copy", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyText("hello")).toBe(false);
  });
});
