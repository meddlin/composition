import { describe, expect, it } from "vitest";
import {
  generate,
  parse,
  render,
  strip,
  tagsFromString,
  tagsToString,
} from "./frontmatter";

// Notes must stay readable by whichever app (terminal, web or desktop) last wrote them,
// including notes written by the Python CLI that preceded the terminal app, so the
// format these cases pin down is not free to change.
const CREATED = "2026-08-26T12:00:00+00:00";
const UPDATED = "2026-08-26T12:00:00+00:00";
const opts = { createdAt: CREATED, updatedAt: UPDATED };

describe("generate", () => {
  it("emits keys in a stable order", () => {
    const block = generate("My Note", { ...opts, description: "desc", tags: ["a"] });

    const order = ["title", "description", "tags", "createdAt", "updatedAt"].map((k) =>
      block.indexOf(k),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("renders tags as an unindented block sequence, like PyYAML", () => {
    const block = generate("My Note", { ...opts, tags: ["a", "b"] });

    expect(block).toContain("tags:\n- a\n- b\n");
    expect(block.startsWith("---\n")).toBe(true);
    expect(block.endsWith("---\n")).toBe(true);
  });
});

describe("parse", () => {
  it("round-trips generate output", () => {
    const block = generate("My Note", { ...opts, description: "desc", tags: ["a", "b"] });

    const [fm, body] = parse(block);

    expect(fm).toEqual({
      title: "My Note",
      description: "desc",
      tags: ["a", "b"],
      createdAt: CREATED,
      updatedAt: UPDATED,
    });
    expect(body).toBe("");
  });

  it("returns null and the content unchanged when there is no frontmatter", () => {
    const content = "# Just a note\n\nNo frontmatter here.";

    expect(parse(content)).toEqual([null, content]);
  });

  it("returns null for malformed YAML instead of throwing", () => {
    const content = "---\ntitle: [unbalanced\n---\nbody";

    expect(parse(content)).toEqual([null, content]);
  });

  it("returns null when the block is not a mapping", () => {
    const content = "---\n- one\n- two\n---\nbody";

    expect(parse(content)).toEqual([null, content]);
  });

  it("handles CRLF line endings", () => {
    const [fm, body] = parse("---\r\ntitle: Note\r\n---\r\nbody");

    expect(fm?.title).toBe("Note");
    expect(body).toBe("body");
  });

  it("coerces an unquoted timestamp scalar to a string", () => {
    const [fm] = parse("---\ntitle: Note\ncreatedAt: 2026-08-26T12:00:00+00:00\n---\n");

    expect(typeof fm?.createdAt).toBe("string");
    expect(new Date(fm!.createdAt).toISOString()).toBe("2026-08-26T12:00:00.000Z");
  });

  it("accepts tags given as a comma-separated scalar", () => {
    const [fm] = parse("---\ntitle: Note\ntags: work, ideas\n---\n");

    expect(fm?.tags).toEqual(["work", "ideas"]);
  });

  it("defaults missing fields to empty values", () => {
    const [fm] = parse("---\ntitle: Note\n---\n");

    expect(fm).toEqual({
      title: "Note",
      description: "",
      tags: [],
      createdAt: "",
      updatedAt: "",
    });
  });
});

describe("render", () => {
  it("reassembles edited frontmatter with the original body", () => {
    const body = "# Heading\n\nSome text.\n";
    const [fm, parsedBody] = parse(generate("My Note", opts) + body);
    expect(parsedBody).toBe(body);

    const rendered = render({ ...fm!, description: "new description" }, parsedBody);

    const [reparsed, reparsedBody] = parse(rendered);
    expect(reparsed?.description).toBe("new description");
    expect(reparsedBody).toBe(body);
  });
});

describe("strip", () => {
  it("removes the block, leaving the body", () => {
    expect(strip(generate("My Note", opts) + "body text")).toBe("body text");
  });

  it("returns content unchanged when there is no frontmatter", () => {
    expect(strip("just text")).toBe("just text");
  });
});

describe("tags helpers", () => {
  it("tagsToString trims and drops empty tags", () => {
    expect(tagsToString(["a", " b ", "", "c"])).toBe("a,b,c");
  });

  it("tagsFromString trims and drops empty entries", () => {
    expect(tagsFromString("a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(tagsFromString("")).toEqual([]);
  });
});
