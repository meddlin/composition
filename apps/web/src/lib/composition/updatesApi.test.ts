import { describe, expect, it } from "vitest";
import { describeUpdateState, updateNeedsAttention, type UpdateState } from "./updatesApi";

const base: UpdateState = { phase: "idle", currentVersion: "0.1.3", supported: true, autoCheck: true };

describe("describeUpdateState", () => {
  it.each([
    [{ ...base }, "Composition 0.1.3. Not checked yet."],
    [{ ...base, lastCheckedAt: "2026-10-14T12:00:00Z" }, "Composition 0.1.3 is up to date."],
    [{ ...base, phase: "checking" }, "Checking for updates…"],
    [{ ...base, phase: "available", version: "0.2.0" }, "Version 0.2.0 is available."],
    [{ ...base, phase: "downloading", version: "0.2.0", percent: 41.6 }, "Downloading version 0.2.0… 42%"],
    [{ ...base, phase: "downloading", version: "0.2.0" }, "Downloading version 0.2.0… 0%"],
    [{ ...base, phase: "ready", version: "0.2.0" }, "Version 0.2.0 is ready. Restart to update."],
    [{ ...base, phase: "error", error: "offline" }, "Couldn't check for updates: offline"],
    [{ ...base, supported: false, unsupportedReason: "Only in the installed app." }, "Only in the installed app."],
  ] as [UpdateState, string][])("says the right thing for %j", (state, text) => {
    expect(describeUpdateState(state)).toBe(text);
  });
});

describe("updateNeedsAttention", () => {
  it("is true only when the person has something to do", () => {
    expect(updateNeedsAttention({ ...base, phase: "available" })).toBe(true);
    expect(updateNeedsAttention({ ...base, phase: "ready" })).toBe(true);
    for (const phase of ["idle", "checking", "downloading", "error"] as const) {
      expect(updateNeedsAttention({ ...base, phase })).toBe(false);
    }
    expect(updateNeedsAttention({ ...base, phase: "ready", supported: false })).toBe(false);
  });
});
