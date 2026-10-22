import { describe, expect, it } from "vitest";
import { failureFromThrown } from "./errors";

/** What Node's fetch throws: a TypeError "fetch failed" whose `cause` carries the system error. */
const fetchFailed = (code: string, message: string) => Object.assign(new TypeError("fetch failed"), { cause: { code, message } });

describe("failureFromThrown", () => {
  // These cannot be provoked on demand, so the errors are built the way Node builds them.
  it.each([
    ["EHOSTUNREACH", "connect EHOSTUNREACH 192.168.1.250:11434 - Local (192.168.1.96:65082)"],
    ["ENETUNREACH", "connect ENETUNREACH 10.0.0.5:11434"],
  ])("says plainly that a computer can't be reached (%s), without Node's wording", (code, message) => {
    const failure = failureFromThrown(fetchFailed(code, message), "http://192.168.1.250:11434");

    expect(failure.kind).toBe("unreachable");
    expect(failure.message).toContain("http://192.168.1.250:11434");
    expect(failure.message).not.toMatch(/EHOSTUNREACH|ENETUNREACH|Local \(/);
    expect(failure.message).toMatch(/network|on and/i);
  });

  it("says that a connection that was cut off was reset", () => {
    const failure = failureFromThrown(fetchFailed("ECONNRESET", "read ECONNRESET"), "http://nas:11434");
    expect(failure.kind).toBe("unreachable");
    expect(failure.message).toMatch(/dropped|reset|closed/i);
    expect(failure.message).not.toContain("ECONNRESET");
  });
});
