import { describe, expect, it } from "vitest";
import { expandCompletion } from "./completions";
import { findFrontmatterTarget } from "./frontmatterProps";

function at(marked: string) {
  const caret = marked.indexOf("|");
  return findFrontmatterTarget(marked.replace("|", ""), caret);
}
const names = (marked: string) => at(marked)?.items.map((item) => item.name);

describe("findFrontmatterTarget", () => {
  it("offers the properties a note lacks on a new line", () => {
    expect(names("---\ntitle: A\ntags: []\n|\n---\nBody")).toEqual([
      "description",
      "createdAt",
      "updatedAt",
      "headerImage",
      "headerImageLayout",
    ]);
  });

  it("narrows by what has been typed", () => {
    expect(names("---\ntitle: A\nhe|\n---\n")).toEqual(["headerImage", "headerImageLayout"]);
  });

  it("offers a property the block has no value for yet while it is being typed", () => {
    expect(names("---\ntitle|\n---\n")).toEqual(["title"]);
    expect(names("---\ntitle: A\ntitle|\n---\n")).toEqual([]);
  });

  it("offers nothing after a colon, outside the block, or in an unfinished one", () => {
    expect(at("---\ntitle: |\n---\n")).toBeNull();
    expect(at("---\ntitle: A\n---\n|Body")).toBeNull();
    expect(at("---\n|\nBody")).toBeNull();
    expect(at("|\n---\ntitle: A\n---\n")).toBeNull();
  });

  it("inserts the key and leaves the caret for the value", () => {
    const tags = at("---\n|\n---\n")!.items.find((item) => item.name === "tags")!;

    expect(expandCompletion(tags)).toEqual({ text: "tags: []", caret: 7 });
  });
});
