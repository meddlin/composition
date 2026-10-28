import { describe, expect, it } from "vitest";
import { DEFAULT_NOTE_BACKGROUND, isNoteBackgroundName, NOTE_BACKGROUND_CHOICES } from "./noteBackgrounds";

describe("note backgrounds", () => {
  it("offers the default, and recognizes only its own names", () => {
    expect(NOTE_BACKGROUND_CHOICES.map(({ name }) => name)).toContain(DEFAULT_NOTE_BACKGROUND);
    for (const { name } of NOTE_BACKGROUND_CHOICES) expect(isNoteBackgroundName(name)).toBe(true);
    expect(isNoteBackgroundName("polka-dots")).toBe(false);
    expect(isNoteBackgroundName(undefined)).toBe(false);
  });
});
