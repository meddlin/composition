import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { docHref, listDocs, readDoc, resolveDocLink } from "./docs";

let root: string;

function write(rel: string, content: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
  write("index.md", "# Docs home\n");
  write("zeta.md", "no heading here\n");
  write("alpha.md", "intro\n\n# Alpha guide\n");
  write("ui/groups.md", "# Groups UI\n");
  write("notes.txt", "ignored");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("listDocs", () => {
  it("lists only Markdown files: index first, then top-level, then subdirectories", () => {
    expect(listDocs(root).map((d) => d.relPath)).toEqual([
      "index.md",
      "alpha.md",
      "zeta.md",
      "ui/groups.md",
    ]);
  });

  it("titles a doc from its first heading, falling back to the file name", () => {
    const titles = Object.fromEntries(listDocs(root).map((d) => [d.relPath, d.title]));
    expect(titles["alpha.md"]).toBe("Alpha guide");
    expect(titles["zeta.md"]).toBe("zeta.md");
  });

  it("maps index.md to the empty slug", () => {
    expect(listDocs(root)[0].slug).toEqual([]);
    expect(docHref(listDocs(root)[0])).toBe("/docs");
  });

  it("returns nothing when the directory is missing", () => {
    expect(listDocs(path.join(root, "nope"))).toEqual([]);
  });
});

describe("readDoc", () => {
  it("reads a doc by slug", () => {
    expect(readDoc(["ui", "groups"], root)?.content).toBe("# Groups UI\n");
    expect(readDoc([], root)?.entry.title).toBe("Docs home");
  });

  it("refuses slugs that are not in the listing, including traversal", () => {
    const outside = path.join(path.dirname(root), `${path.basename(root)}-secret.md`);
    fs.writeFileSync(outside, "secret");
    try {
      expect(readDoc(["missing"], root)).toBeNull();
      expect(readDoc(["..", path.basename(outside, ".md")], root)).toBeNull();
    } finally {
      fs.rmSync(outside);
    }
  });
});

describe("resolveDocLink", () => {
  it("resolves relative links between docs, keeping the hash", () => {
    const docs = listDocs(root);
    const groups = docs.find((d) => d.relPath === "ui/groups.md")!;
    expect(resolveDocLink(groups, "../alpha.md", docs)).toBe("/docs/alpha");
    expect(resolveDocLink(groups, "../alpha.md#top", docs)).toBe("/docs/alpha#top");
    expect(resolveDocLink(docs[0], "ui/groups.md", docs)).toBe("/docs/ui/groups");
  });

  it("returns null for external, absolute, anchor, source-file and unknown links", () => {
    const docs = listDocs(root);
    for (const href of [
      "https://example.com/a.md",
      "/abs.md",
      "#section",
      "../../apps/web/src/x.tsx",
      "missing.md",
    ]) {
      expect(resolveDocLink(docs[0], href, docs)).toBeNull();
    }
  });
});
