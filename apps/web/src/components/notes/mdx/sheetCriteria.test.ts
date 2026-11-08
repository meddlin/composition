import { describe, expect, it } from "vitest";
import { hasWildcard, matchesPattern, parseCriterion, wildcardFind, wildcardMatcher } from "./sheetCriteria";
import { ERR, Unsupported } from "./sheetValue";

describe("wildcards", () => {
  it("matches * and ? as Excel does, and ~ takes the next one literally", () => {
    expect(wildcardMatcher("a*c")("abbbc")).toBe(true);
    expect(wildcardMatcher("a?c")("abc")).toBe(true);
    expect(wildcardMatcher("a?c")("ac")).toBe(false);
    expect(wildcardMatcher("a~*c")("a*c")).toBe(true);
    expect(wildcardMatcher("a~*c")("abc")).toBe(false);
    expect(wildcardMatcher("a~~c")("a~c")).toBe(true);
    expect(wildcardMatcher("a*c")("A-C")).toBe(true);
    expect(wildcardMatcher("*")("")).toBe(true);
    expect(wildcardMatcher("a**b")("ab")).toBe(true);
    expect(wildcardMatcher("a*b*c")("aXbYbZc")).toBe(true);
    expect(wildcardMatcher("a*b")("abc")).toBe(false);
    expect(wildcardMatcher("~")("~")).toBe(true);
  });

  it("matches the other characters of a pattern literally, including those a regular expression would take for its own", () => {
    expect(matchesPattern("a.c", "abc")).toBe(false);
    expect(matchesPattern("a.c", "a.c")).toBe(true);
    expect(matchesPattern("(a)+[b]", "(a)+[b]")).toBe(true);
    expect(matchesPattern("$5", "$5")).toBe(true);
    expect(matchesPattern("a|b", "a")).toBe(false);
    expect(hasWildcard("plain")).toBe(false);
    expect(hasWildcard("a~b")).toBe(true);
  });

  it("takes no longer on a pattern of many stars than on one of few, where a regular expression would take years", () => {
    const text = "a".repeat(5000);

    expect(matchesPattern(`${"*a".repeat(30)}*b`, text)).toBe(false);
    expect(wildcardFind(`${"*a".repeat(30)}*b`, text)).toBe(-1);
    expect(matchesPattern(`${"*a".repeat(30)}*`, text)).toBe(true);
  });

  it("finds where a pattern first matches inside a text, as SEARCH does", () => {
    expect(wildcardFind("b?d", "abcd")).toBe(1);
    expect(wildcardFind("a*c", "xabcx")).toBe(1);
    expect(wildcardFind("B", "abc")).toBe(1);
    expect(wildcardFind("b", "abcb", 2)).toBe(3);
    expect(wildcardFind("~?", "a?b")).toBe(1);
    expect(wildcardFind("z", "abc")).toBe(-1);
    expect(wildcardFind("", "abc")).toBe(0);
  });

  it("matches across a line break, which ? and * are not stopped by", () => {
    expect(matchesPattern("a*b", "a\nb")).toBe(true);
    expect(matchesPattern("a?b", "a\nb")).toBe(true);
  });
});

describe("parseCriterion", () => {
  it("reads a number as 'equal to', for a number and for a text of it", () => {
    const equal = parseCriterion(30);
    expect(equal(30)).toBe(true);
    expect(equal("30")).toBe(true);
    expect(equal(31)).toBe(false);
    expect(equal(null)).toBe(false);
    expect(parseCriterion("30")(30)).toBe(true);
    expect(parseCriterion("=30")("30")).toBe(true);
  });

  it("orders numbers only among numbers, so a text that looks like one is not counted by >", () => {
    expect(parseCriterion(">1")(2)).toBe(true);
    expect(parseCriterion(">1")("2")).toBe(false);
    expect(parseCriterion(">=1")(1)).toBe(true);
    expect(parseCriterion("<1")(null)).toBe(false);
    expect(parseCriterion("<>1")("x")).toBe(true);
  });

  it("reads text with an operator, and an operator must be the first character", () => {
    expect(parseCriterion("<>apple")("APPLE")).toBe(false);
    expect(parseCriterion("<>apple")("pear")).toBe(true);
    expect(parseCriterion(">b")("Banana")).toBe(true);
    expect(parseCriterion(" >30")(" >30")).toBe(true);
    expect(parseCriterion(" >30")(40)).toBe(false);
  });

  it("tells a blank cell from an empty text, as COUNTIF does", () => {
    expect(parseCriterion("")(null)).toBe(true);
    expect(parseCriterion("")("")).toBe(true);
    expect(parseCriterion("=")("")).toBe(false);
    expect(parseCriterion("=")(null)).toBe(true);
    expect(parseCriterion("<>")("")).toBe(true);
    expect(parseCriterion("<>")(null)).toBe(false);
  });

  it("reads logicals and errors, and a blank criterion as 0", () => {
    expect(parseCriterion("true")(true)).toBe(true);
    expect(parseCriterion(true)(1)).toBe(false);
    expect(parseCriterion("#N/A")(ERR.NA)).toBe(true);
    expect(parseCriterion("#N/A")(ERR.REF)).toBe(false);
    expect(parseCriterion(ERR.REF)(ERR.REF)).toBe(true);
    expect(parseCriterion(null)(0)).toBe(true);
    expect(parseCriterion(null)(null)).toBe(false);
  });

  it("says it cannot do what Excel reads as a date, or an order of logicals", () => {
    expect(() => parseCriterion(">=1/2/2026")).toThrow(Unsupported);
    expect(() => parseCriterion(">TRUE")).toThrow(Unsupported);
    expect(() => parseCriterion(">#N/A")).toThrow(Unsupported);
  });
});
