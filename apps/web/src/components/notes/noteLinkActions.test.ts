import { describe, expect, it, vi } from "vitest";
import { deadLink, followLink, fragmentOffset, linkTarget, webHref, type NoteLinks } from "./noteLinkActions";

const uuid = "3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a";

function app(over: Partial<NoteLinks> = {}): NoteLinks {
  return { exists: () => true, open: vi.fn(), pdf: { exists: () => true, open: vi.fn() }, ...over };
}

describe("linkTarget", () => {
  it.each([
    ["note:42", { kind: "note", noteId: 42 }],
    [`pdf:${uuid}#p=3`, { kind: "pdf", ref: { uuid, page: 3, mark: null } }],
    ["#a-heading", { kind: "fragment", id: "a-heading" }],
    ["https://example.com", { kind: "other", href: "https://example.com" }],
    ["note:abc", { kind: "other", href: "note:abc" }],
  ])("%s", (href, target) => {
    expect(linkTarget(href)).toEqual(target);
  });
});

describe("deadLink", () => {
  it("says why a link to a gone note or an absent PDF goes nowhere, and nothing for a live one", () => {
    expect(deadLink(linkTarget("note:1"), app({ exists: () => false }))).toBe("This note no longer exists");
    expect(deadLink(linkTarget(`pdf:${uuid}`), app({ pdf: undefined }))).toBe("PDF not on this device");
    expect(deadLink(linkTarget("note:1"), app())).toBeNull();
    expect(deadLink(linkTarget("https://x.y"), app({ exists: () => false }))).toBeNull();
  });
});

describe("followLink", () => {
  const scrollTo = vi.fn();

  it("opens a note, in place or beside", () => {
    const links = app();
    expect(followLink(linkTarget("note:5"), links, { beside: false, scrollTo })).toBe(true);
    followLink(linkTarget("note:5"), links, { beside: true, scrollTo });
    expect(vi.mocked(links.open).mock.calls).toEqual([
      [5, false],
      [5, true],
    ]);
  });

  it("shows a PDF's page", () => {
    const links = app();
    followLink(linkTarget(`pdf:${uuid}#p=2`), links, { beside: false, scrollTo });
    expect(links.pdf!.open).toHaveBeenCalledWith({ uuid, page: 2, mark: null });
  });

  it("does nothing for a dead link, but says it handled it, so the browser does not follow it either", () => {
    const links = app({ exists: () => false });
    expect(followLink(linkTarget("note:5"), links, { beside: false, scrollTo })).toBe(true);
    expect(links.open).not.toHaveBeenCalled();
  });

  it("scrolls to a #id", () => {
    followLink(linkTarget("#intro"), app(), { beside: false, scrollTo });
    expect(scrollTo).toHaveBeenCalledWith("intro");
  });

  it("opens a web address only where it is given a way to, and never another scheme", () => {
    const openWeb = vi.fn();
    expect(followLink(linkTarget("https://example.com"), app(), { beside: false, scrollTo })).toBe(false);
    expect(followLink(linkTarget("https://example.com"), app(), { beside: false, scrollTo, openWeb })).toBe(true);
    expect(followLink(linkTarget("javascript:alert(1)"), app(), { beside: false, scrollTo, openWeb })).toBe(false);
    expect(openWeb.mock.calls).toEqual([["https://example.com"]]);
  });
});

describe("webHref", () => {
  it("lets through http, https and mailto only", () => {
    expect(["https://a.b", "HTTP://a.b", "mailto:a@b.c", "javascript:x", "file:///etc", "data:text/html,x"].map(webHref)).toEqual([
      "https://a.b",
      "HTTP://a.b",
      "mailto:a@b.c",
      null,
      null,
      null,
    ]);
  });
});

describe("fragmentOffset", () => {
  const text = "---\ntitle: x\n---\n# Intro\n\nSee[^1].\n\n## Next Steps!\n\n## Next Steps\n\n```\n# not a heading\n```\n\n[^1]: The note.\n";

  it("finds a heading by the id the preview gives it", () => {
    expect(fragmentOffset(text, "intro", 17)).toBe(text.indexOf("# Intro"));
    expect(fragmentOffset(text, "next-steps", 17)).toBe(text.indexOf("## Next Steps!"));
    // A repeated heading gets `-1`, as in the preview.
    expect(fragmentOffset(text, "next-steps-1", 17)).toBe(text.lastIndexOf("## Next Steps"));
  });

  it("finds a footnote's definition and its reference", () => {
    expect(fragmentOffset(text, "user-content-fn-1", 17)).toBe(text.indexOf("[^1]:"));
    expect(fragmentOffset(text, "fnref-1", 17)).toBe(text.indexOf("[^1]"));
  });

  it("is null for an id nothing has, and skips fenced code", () => {
    expect(fragmentOffset(text, "nowhere", 17)).toBeNull();
    expect(fragmentOffset(text, "not-a-heading", 17)).toBeNull();
  });
});
