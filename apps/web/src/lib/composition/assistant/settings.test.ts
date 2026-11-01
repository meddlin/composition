import { describe, expect, it } from "vitest";
import { checkAssistantSettings, DEFAULT_ASSISTANT_SETTINGS, parseAssistantSettings } from "./settings";

describe("DEFAULT_ASSISTANT_SETTINGS", () => {
  it("is Ollama's own address and an 8,192-token window", () => {
    expect(DEFAULT_ASSISTANT_SETTINGS).toEqual({ serverUrl: "http://127.0.0.1:11434", contextTokens: 8192 });
  });
});

describe("parseAssistantSettings", () => {
  it("reads saved settings", () => {
    expect(parseAssistantSettings({ serverUrl: "http://192.168.1.5:11434", contextTokens: 16384 })).toEqual({
      serverUrl: "http://192.168.1.5:11434",
      contextTokens: 16384,
    });
  });

  it("falls back to the default for each setting that is missing or unusable, keeping the other", () => {
    expect(parseAssistantSettings({ serverUrl: "ftp://x", contextTokens: 4096 })).toEqual({
      serverUrl: "http://127.0.0.1:11434",
      contextTokens: 4096,
    });
    expect(parseAssistantSettings({ serverUrl: "http://nas:11434", contextTokens: "lots" })).toEqual({
      serverUrl: "http://nas:11434",
      contextTokens: 8192,
    });
    expect(parseAssistantSettings({ serverUrl: "http://nas:11434", contextTokens: 12.5 }).contextTokens).toBe(8192);
    expect(parseAssistantSettings({ serverUrl: "http://nas:11434", contextTokens: 10 }).contextTokens).toBe(8192);
    expect(parseAssistantSettings({ serverUrl: "http://nas:11434", contextTokens: 9e9 }).contextTokens).toBe(8192);
  });

  it("gives the defaults for anything that is not an object", () => {
    for (const value of [undefined, null, "http://x", 5, []]) {
      expect(parseAssistantSettings(value)).toEqual(DEFAULT_ASSISTANT_SETTINGS);
    }
  });

  it("normalizes a saved address the way entering it would", () => {
    expect(parseAssistantSettings({ serverUrl: "NAS:11434/", contextTokens: 8192 }).serverUrl).toBe("http://nas:11434");
  });
});

describe("checkAssistantSettings", () => {
  it("accepts an address and a window, and returns them normalized", () => {
    expect(checkAssistantSettings({ serverUrl: " http://NAS.local:11434/ ", contextTokens: 32768 })).toEqual({
      ok: true,
      settings: { serverUrl: "http://nas.local:11434", contextTokens: 32768 },
    });
  });

  it("takes a blank address to mean Ollama's own", () => {
    expect(checkAssistantSettings({ serverUrl: "", contextTokens: 8192 })).toEqual({
      ok: true,
      settings: { serverUrl: "http://127.0.0.1:11434", contextTokens: 8192 },
    });
  });

  it("refuses an address that cannot work, saying why", () => {
    const result = checkAssistantSettings({ serverUrl: "http://nas:22", contextTokens: 8192 });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/port 22/i);
  });

  it.each([0, 1023, 1048577, 8192.5, Number.NaN, Infinity])("refuses a window of %s tokens", (contextTokens) => {
    const result = checkAssistantSettings({ serverUrl: "", contextTokens });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/1,024.*1,048,576/);
  });

  it.each([1024, 1048576])("accepts a window of %i tokens, the smallest and the largest", (contextTokens) => {
    expect(checkAssistantSettings({ serverUrl: "", contextTokens })).toMatchObject({ ok: true });
  });

  it("refuses input that is not the right shape", () => {
    expect(checkAssistantSettings(null)).toMatchObject({ ok: false });
    expect(checkAssistantSettings({ serverUrl: 5, contextTokens: 8192 })).toMatchObject({ ok: false });
    expect(checkAssistantSettings({ serverUrl: "", contextTokens: "8192" })).toMatchObject({ ok: false });
  });
});

describe("the alternate address", () => {
  it("is read back normalized, and left out when absent, blank, unusable or the same as the first address", () => {
    expect(parseAssistantSettings({ serverUrl: "http://nas:11434", alternateUrl: "100.64.0.9:11434/", contextTokens: 8192 })).toEqual({
      serverUrl: "http://nas:11434",
      alternateUrl: "http://100.64.0.9:11434",
      contextTokens: 8192,
    });
    for (const alternateUrl of [undefined, "", "  ", "ftp://x", 5, "http://NAS:11434/"]) {
      expect(parseAssistantSettings({ serverUrl: "http://nas:11434", alternateUrl, contextTokens: 8192 })).not.toHaveProperty("alternateUrl");
    }
  });

  it("is accepted when entered, and means none when blank or missing", () => {
    expect(checkAssistantSettings({ serverUrl: "nas", alternateUrl: " 100.64.0.9:11434 ", contextTokens: 8192 })).toEqual({
      ok: true,
      settings: { serverUrl: "http://nas", alternateUrl: "http://100.64.0.9:11434", contextTokens: 8192 },
    });
    expect(checkAssistantSettings({ serverUrl: "nas", alternateUrl: "", contextTokens: 8192 })).toEqual({
      ok: true,
      settings: { serverUrl: "http://nas", contextTokens: 8192 },
    });
  });

  it("is refused, saying which address is wrong, when it cannot work or repeats the first", () => {
    const unusable = checkAssistantSettings({ serverUrl: "nas", alternateUrl: "ftp://tail", contextTokens: 8192 });
    expect(!unusable.ok && unusable.error).toMatch(/^Alternate address: .*http/i);
    const same = checkAssistantSettings({ serverUrl: "http://nas:80", alternateUrl: "NAS", contextTokens: 8192 });
    expect(!same.ok && same.error).toMatch(/same as the server address/i);
    expect(checkAssistantSettings({ serverUrl: "nas", alternateUrl: 5, contextTokens: 8192 })).toMatchObject({ ok: false });
  });
});
