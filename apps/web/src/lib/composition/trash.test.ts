import { describe, expect, it } from "vitest";
import { daysLeft, expiryOf, retentionCutoff, TRASH_RETENTION_DAYS } from "./trash";

const DAY_MS = 86_400_000;

describe("trash retention", () => {
  it("keeps items for 60 days", () => {
    expect(TRASH_RETENTION_DAYS).toBe(60);
    expect(expiryOf("2026-01-01T00:00:00.000Z")).toBe("2026-03-02T00:00:00.000Z");
  });

  it("counts whole days left, rounding up and never going negative", () => {
    const expiresAt = "2026-03-02T00:00:00.000Z";

    expect(daysLeft(expiresAt, new Date("2026-01-01T00:00:00.000Z"))).toBe(60);
    expect(daysLeft(expiresAt, new Date("2026-03-01T12:00:00.000Z"))).toBe(1);
    expect(daysLeft(expiresAt, new Date("2026-03-02T00:00:00.000Z"))).toBe(0);
    expect(daysLeft(expiresAt, new Date("2026-04-01T00:00:00.000Z"))).toBe(0);
  });

  it("puts the cutoff 60 days back, so only older items have expired", () => {
    const now = new Date("2026-03-02T00:00:00.000Z");

    expect(retentionCutoff(now)).toBe("2026-01-01T00:00:00.000Z");
    expect(new Date(retentionCutoff(now)).getTime()).toBe(now.getTime() - 60 * DAY_MS);
  });
});
