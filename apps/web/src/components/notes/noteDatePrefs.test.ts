import { describe, expect, it } from "vitest";
import { noteDateLine, parseNoteDatePrefs } from "./noteDatePrefs";

const note = { createdAt: "2026-10-03T12:00:00.000Z", updatedAt: "2026-10-27T12:00:00.000Z" };
const rel = () => "2 hr ago";

describe("parseNoteDatePrefs", () => {
  it("defaults to updated only", () => {
    expect(parseNoteDatePrefs(null)).toEqual({ updated: true, created: false });
    expect(parseNoteDatePrefs("not json")).toEqual({ updated: true, created: false });
  });
  it("keeps stored booleans and ignores junk", () => {
    expect(parseNoteDatePrefs('{"updated":false,"created":true}')).toEqual({ updated: false, created: true });
    expect(parseNoteDatePrefs('{"updated":"x"}')).toEqual({ updated: true, created: false });
  });
});

describe("noteDateLine", () => {
  it("is empty when both are off", () => {
    expect(noteDateLine(note, { updated: false, created: false }, rel)).toBe("");
  });
  it("shows updated alone", () => {
    expect(noteDateLine(note, { updated: true, created: false }, rel)).toBe("Updated 2 hr ago");
  });
  it("joins both", () => {
    expect(noteDateLine(note, { updated: true, created: true }, rel)).toMatch(/^Updated 2 hr ago · Created .*2026$/);
  });
  it("skips an unreadable date", () => {
    expect(noteDateLine({ ...note, createdAt: "x" }, { updated: false, created: true }, rel)).toBe("");
  });
});
