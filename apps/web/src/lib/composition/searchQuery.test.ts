import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./searchQuery";

describe("parseSearchQuery", () => {
  it("treats plain text as free text with no filters", () => {
    expect(parseSearchQuery("hello world")).toEqual({
      text: "hello world",
      filters: [],
      attributesToSearchOn: undefined,
    });
  });

  it("filters by an unquoted multi-word tag", () => {
    const parsed = parseSearchQuery("tags: web development");

    expect(parsed.filters).toEqual(['tags = "web development"']);
    expect(parsed.text).toBe("");
  });

  it("accepts tag and tags, with or without a space after the colon", () => {
    for (const query of ["tag:rust", "tag: rust", "tags:rust", "TAGS: rust"]) {
      expect(parseSearchQuery(query).filters).toEqual(['tags = "rust"']);
    }
  });

  it("ends a quoted value at the closing quote so free text can follow it", () => {
    const parsed = parseSearchQuery('tags:"web development" async');

    expect(parsed.filters).toEqual(['tags = "web development"']);
    expect(parsed.text).toBe("async");
  });

  it("ANDs repeated tags", () => {
    expect(parseSearchQuery("tags: rust tags: web development").filters).toEqual([
      'tags = "rust"',
      'tags = "web development"',
    ]);
  });

  it("ends an unquoted value at the next field", () => {
    const parsed = parseSearchQuery("title: async tags: rust");

    expect(parsed.filters).toEqual(['tags = "rust"']);
    expect(parsed.text).toBe("async");
    expect(parsed.attributesToSearchOn).toEqual(["title"]);
  });

  it("keeps free text that comes before a field", () => {
    const parsed = parseSearchQuery("borrow checker tags: rust");

    expect(parsed.text).toBe("borrow checker");
    expect(parsed.filters).toEqual(['tags = "rust"']);
    expect(parsed.attributesToSearchOn).toBeUndefined();
  });

  it("searches only titles for title:", () => {
    const parsed = parseSearchQuery("title: Next.js routing");

    expect(parsed.text).toBe("Next.js routing");
    expect(parsed.attributesToSearchOn).toEqual(["title"]);
    expect(parsed.filters).toEqual([]);
  });

  it("searches descriptions for description:", () => {
    expect(parseSearchQuery("description: weekly review").attributesToSearchOn).toEqual([
      "description",
    ]);
  });

  it("searches every named text field when title and description are both given", () => {
    const parsed = parseSearchQuery("title: a description: b");

    expect(parsed.text).toBe("a b");
    expect(parsed.attributesToSearchOn).toEqual(["title", "description"]);
  });

  it("escapes quotes and backslashes in filter values", () => {
    expect(parseSearchQuery('tags: 6" pipe').filters).toEqual(['tags = "6\\" pipe"']);
    expect(parseSearchQuery("tags: a\\b").filters).toEqual(['tags = "a\\\\b"']);
  });

  it("does not treat a field name inside a word as a field", () => {
    const parsed = parseSearchQuery("metatag:x https://example.com/title:y");

    expect(parsed.filters).toEqual([]);
    expect(parsed.text).toBe("metatag:x https://example.com/title:y");
  });

  it("ignores a field that has no value yet", () => {
    expect(parseSearchQuery("tags:")).toEqual({
      text: "",
      filters: [],
      attributesToSearchOn: undefined,
    });
    expect(parseSearchQuery("rust tags:  ").text).toBe("rust");
  });

  it("treats an unknown field as free text", () => {
    expect(parseSearchQuery("author: sam").text).toBe("author: sam");
  });

  it("tolerates an unterminated quote", () => {
    expect(parseSearchQuery('tags:"web dev').filters).toEqual(['tags = "web dev"']);
  });

  describe("dates", () => {
    const DAY_START = Date.UTC(2026, 4, 30) / 1000;
    const DAY_END = DAY_START + 86_400;

    it("defaults to the whole day", () => {
      expect(parseSearchQuery("created: 2026-05-30").filters).toEqual([
        `created_at_ts >= ${DAY_START}`,
        `created_at_ts < ${DAY_END}`,
      ]);
    });

    it.each([
      [">2026-05-30", [`created_at_ts >= ${DAY_END}`]],
      [">=2026-05-30", [`created_at_ts >= ${DAY_START}`]],
      ["<2026-05-30", [`created_at_ts < ${DAY_START}`]],
      ["<=2026-05-30", [`created_at_ts < ${DAY_END}`]],
      ["=2026-05-30", [`created_at_ts >= ${DAY_START}`, `created_at_ts < ${DAY_END}`]],
    ])("supports the %s operator", (value, expected) => {
      expect(parseSearchQuery(`created: ${value}`).filters).toEqual(expected);
    });

    it("accepts the frontmatter and CLI spellings, and updated dates", () => {
      expect(parseSearchQuery("createdAt: >=2026-05-30").filters).toEqual([
        `created_at_ts >= ${DAY_START}`,
      ]);
      expect(parseSearchQuery("createdOn: >=2026-05-30").filters).toEqual([
        `created_at_ts >= ${DAY_START}`,
      ]);
      expect(parseSearchQuery("updated: <2026-05-30").filters).toEqual([
        `updated_at_ts < ${DAY_START}`,
      ]);
    });

    it("keeps a malformed or impossible date as literal text", () => {
      expect(parseSearchQuery("created: 2026-05")).toMatchObject({
        text: "created: 2026-05",
        filters: [],
      });
      expect(parseSearchQuery("created: 2026-02-31").filters).toEqual([]);
    });
  });

  it("combines every kind of clause", () => {
    const parsed = parseSearchQuery("tags: web development title: routing created: >=2026-05-30");

    expect(parsed.filters).toEqual(['tags = "web development"', expect.stringContaining("created_at_ts >=")]);
    expect(parsed.text).toBe("routing");
    expect(parsed.attributesToSearchOn).toEqual(["title"]);
  });
});
