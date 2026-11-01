import { describe, expect, it } from "vitest";
import { cleanReadingTitle, hostLabel, normalizeReadingUrl, readingItemLabel, sortReadingItems } from "./readingList";
import type { ReadingItem } from "./readingListApi";

describe("normalizeReadingUrl", () => {
  it.each([
    ["https://example.com/a", "https://example.com/a"],
    ["  https://example.com/a  ", "https://example.com/a"],
    ["http://example.com/a", "http://example.com/a"],
    ["example.com/a", "https://example.com/a"],
    ["example.com", "https://example.com/"],
    ["example.com:8080/a", "https://example.com:8080/a"],
    ["localhost:3000", "https://localhost:3000/"],
    ["HTTPS://Example.com/A", "https://example.com/A"],
    ["https://example.com/a#section-2", "https://example.com/a"],
    ["https://example.com/a?x=1&y=2#top", "https://example.com/a?x=1&y=2"],
    ["//example.com/a", "https://example.com/a"],
  ])("accepts %s as %s", (input, url) => {
    expect(normalizeReadingUrl(input)).toEqual({ url });
  });

  it.each([
    [""],
    ["   "],
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["file:///etc/passwd"],
    ["app://composition/index.html"],
    ["mailto:someone@example.com"],
    ["blob:https://example.com/1234"],
    ["about:blank"],
    ["view-source:https://example.com"],
    ["ftp://example.com/file"],
    ["chrome://settings"],
    ["https://"],
    ["not a link"],
    ["https://user:secret@example.com/"],
    [`https://example.com/${"a".repeat(2100)}`],
  ])("refuses %j", (input) => {
    expect(normalizeReadingUrl(input).error).toBeTruthy();
  });

  it("gives the same address for the same page however it was typed, so a duplicate is caught", () => {
    const forms = ["example.com/a", "https://example.com/a", "https://example.com/a#x", " HTTPS://EXAMPLE.COM/a "];
    expect(new Set(forms.map((form) => normalizeReadingUrl(form).url)).size).toBe(1);
  });
});

describe("hostLabel", () => {
  it("is the host name without www", () => {
    expect(hostLabel("https://www.example.com/a/b")).toBe("example.com");
    expect(hostLabel("https://blog.example.com/")).toBe("blog.example.com");
  });

  it("falls back to the text when it is not an address", () => {
    expect(hostLabel("nonsense")).toBe("nonsense");
  });
});

describe("readingItemLabel", () => {
  it("is the title, or the host until there is one", () => {
    expect(readingItemLabel({ url: "https://www.example.com/a", title: "A post" })).toBe("A post");
    expect(readingItemLabel({ url: "https://www.example.com/a", title: "" })).toBe("example.com");
  });
});

describe("cleanReadingTitle", () => {
  it("puts the title on one line", () => {
    expect(cleanReadingTitle("  A\n  post \t here ")).toBe("A post here");
  });

  it("is null when nothing is left", () => {
    expect(cleanReadingTitle(" \n ")).toBeNull();
  });

  it("cuts a long title", () => {
    expect(cleanReadingTitle("x".repeat(500))).toHaveLength(300);
  });
});

describe("sortReadingItems", () => {
  const item = (id: number, read: boolean): ReadingItem => ({ id, url: `https://e.com/${id}`, title: "", read, createdAt: "", updatedAt: "" });

  it("puts unread above read, each oldest first, without changing the list it was given", () => {
    const items = [item(1, true), item(2, false), item(3, true), item(4, false)];
    expect(sortReadingItems(items).map((i) => i.id)).toEqual([2, 4, 1, 3]);
    expect(items.map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });
});
