import { describe, expect, it } from "vitest";
import { follow, marksOf, offsetAtY, parseBlockSource, yAtOffset } from "./scrollSync";

// The same cases as the iPad's (apps/ios/CompositionCore/Tests/CompositionCoreTests/ScrollSyncTests.swift).
const block = (start: number, length: number, top: number, bottom: number) => ({ start, end: start + length, top, bottom });

describe("Split's halves kept at the same place in the note", () => {
  // A header of 120 px above two blocks, the second a tall picture written as a short tag.
  const marks = marksOf([block(40, 20, 120, 160), block(62, 30, 180, 780)], 100, 800);

  it("runs the marks from the top of the note through each block to its end, in order both ways", () => {
    expect(marks.map((m) => m.offset)).toEqual([0, 40, 60, 62, 92, 100]);
    expect(marks.map((m) => m.y)).toEqual([0, 120, 160, 180, 780, 800]);
  });

  it("puts blocks given out of order in order, and leaves out one that would go back up the page", () => {
    const shuffled = marksOf([block(62, 30, 180, 780), block(40, 20, 120, 160), block(95, 2, 100, 110)], 100, 800);
    expect(shuffled.map((m) => m.offset)).toEqual([0, 40, 60, 62, 92, 100]);
  });

  it("draws a place inside a block the same fraction of the way down it: a tall picture is passed through as its tag is", () => {
    expect(yAtOffset(marks, 50)).toBe(140);
    expect(yAtOffset(marks, 72)).toBe(380);
    expect(offsetAtY(marks, 380)).toBe(72);
  });

  it("moves evenly through the gap between two blocks, and through the frontmatter above the first", () => {
    expect(yAtOffset(marks, 61)).toBe(170);
    expect(yAtOffset(marks, 20)).toBe(60);
    expect(offsetAtY(marks, 60)).toBe(20);
  });

  it("gives the end past either end", () => {
    const short = marksOf([block(40, 20, 120, 160)], 100, 300);
    expect(yAtOffset(short, -5)).toBe(0);
    expect(yAtOffset(short, 500)).toBe(300);
    expect(offsetAtY(short, 1000)).toBe(100);
    expect(offsetAtY(short, -10)).toBe(0);
    expect(yAtOffset([], 10)).toBe(0);
  });

  it("gives the first place for text drawn with no height, so the editor shows the start of it", () => {
    const flat = marksOf([block(40, 20, 120, 120), block(62, 30, 180, 300)], 100, 320);
    expect(offsetAtY(flat, 120)).toBe(40);
    expect(yAtOffset(flat, 50)).toBe(120);
  });

  it("comes home when mapped one way and back", () => {
    const many = marksOf([block(10, 50, 90, 400), block(70, 5, 410, 900), block(80, 15, 920, 960)], 120, 1000);
    for (let offset = 0; offset <= 120; offset += 7.5) {
      expect(offsetAtY(many, yAtOffset(many, offset))).toBeCloseTo(offset, 6);
    }
  });

  it("sends the other side to its top at the very top, to its bottom at the very bottom, and otherwise to the matching place within its reach", () => {
    expect(follow(300, 900, 0.5, 2000)).toBe(0);
    expect(follow(300, 900, 1999.5, 2000)).toBe(900);
    expect(follow(300, 900, 700, 2000)).toBe(300);
    expect(follow(1300, 900, 700, 2000)).toBe(900);
    expect(follow(-20, 900, 700, 2000)).toBe(0);
    // A side too short to scroll has no bottom to go to.
    expect(follow(300, -40, 700, 2000)).toBe(0);
  });

  it("reads a block's place from its attribute, moved past the frontmatter", () => {
    expect(parseBlockSource("4-19", 30)).toEqual({ start: 34, end: 49 });
    expect(parseBlockSource(null, 0)).toBeNull();
    expect(parseBlockSource("x-1", 0)).toBeNull();
    expect(parseBlockSource("9-3", 0)).toBeNull();
  });
});
