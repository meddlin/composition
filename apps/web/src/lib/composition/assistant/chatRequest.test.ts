import { describe, expect, it } from "vitest";
import { checkChatRequest, MAX_REQUEST_CHARS } from "./chatRequest";

const good = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };

const refused = (input: unknown) => {
  const result = checkChatRequest(input);
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
};

describe("checkChatRequest", () => {
  it("accepts a well-formed request and returns only the known fields", () => {
    const result = checkChatRequest({ ...good, extra: true, messages: [{ role: "system", content: "s", extra: 1 }, { role: "assistant", content: "a" }] });
    expect(result).toEqual({
      ok: true,
      request: { model: "qwen3:0.6b", numCtx: 8192, messages: [{ role: "system", content: "s" }, { role: "assistant", content: "a" }] },
    });
  });

  it.each([null, "x", 5, [], undefined])("refuses %j, which is not an object", (input) => {
    expect(refused(input)).toBeTruthy();
  });

  it.each([
    [{ ...good, model: "" }],
    [{ ...good, model: 5 }],
    [{ ...good, model: "m".repeat(201) }],
    [{ ...good, messages: [] }],
    [{ ...good, messages: "hi" }],
    [{ ...good, messages: [{ role: "tool", content: "x" }] }],
    [{ ...good, messages: [{ role: "user", content: 5 }] }],
    [{ ...good, messages: [null] }],
    [{ ...good, numCtx: 100 }],
    [{ ...good, numCtx: 8192.5 }],
    [{ ...good, numCtx: "8192" }],
    [{ ...good, numCtx: 2_000_000 }],
  ])("refuses a malformed request %#", (input) => {
    expect(refused(input)).toBeTruthy();
  });

  it("refuses a request too large to be a note and a conversation", () => {
    const big = { ...good, messages: [{ role: "user", content: "x".repeat(MAX_REQUEST_CHARS + 1) }] };
    expect(refused(big)).toMatch(/too large|too long/i);
    expect(checkChatRequest({ ...good, messages: [{ role: "user", content: "x".repeat(MAX_REQUEST_CHARS) }] })).toMatchObject({ ok: true });
  });

  it("refuses a cloud model by name, saying why", () => {
    for (const model of ["gpt-oss:20b:cloud", "gemma4:cloud", "x:120b-cloud"]) {
      expect(refused({ ...good, model })).toMatch(/ollama\.com/i);
    }
  });
});
