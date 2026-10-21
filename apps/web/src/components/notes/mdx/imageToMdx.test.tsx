// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteMarkdown } from "../NoteMarkdown";
import { imagesToMdx, isImageToMdxShortcut } from "./imageToMdx";

const key = { key: "m", shiftKey: true, altKey: false, metaKey: true, ctrlKey: false };

/** Applies the conversion the way the editor would, for readable expectations. */
function convert(text: string, from: number, to = from): string | null {
  const edit = imagesToMdx(text, from, to);
  return edit && text.slice(0, edit.start) + edit.text + text.slice(edit.end);
}

describe("isImageToMdxShortcut", () => {
  it("is Cmd+Shift+M or Ctrl+Shift+M", () => {
    expect(isImageToMdxShortcut(key)).toBe(true);
    expect(isImageToMdxShortcut({ ...key, metaKey: false, ctrlKey: true })).toBe(true);
    expect(isImageToMdxShortcut({ ...key, key: "M" })).toBe(true);
  });

  it.each([{ shiftKey: false }, { metaKey: false }, { altKey: true }, { key: "k" }])("is not %j", (change) => {
    expect(isImageToMdxShortcut({ ...key, ...change })).toBe(false);
  });
});

describe("imagesToMdx", () => {
  const image = "![Route map](app_data/trip-0123456789ab.png)";
  const tag = '<Image src="app_data/trip-0123456789ab.png" alt="Route map" />';

  it("converts the image the caret is in", () => {
    expect(convert(`before ${image} after`, 15)).toBe(`before ${tag} after`);
  });

  it("counts a caret right before the ! or right after the ) as on the image", () => {
    expect(convert(`a ${image} b`, 2)).toBe(`a ${tag} b`);
    expect(convert(`a ${image} b`, 2 + image.length)).toBe(`a ${tag} b`);
  });

  it("leaves a caret anywhere else alone", () => {
    expect(imagesToMdx(`a ${image} b`, 1, 1)).toBeNull();
    expect(imagesToMdx(`a ${image} b`, 3 + image.length, 3 + image.length)).toBeNull();
    expect(imagesToMdx("no images here", 3, 3)).toBeNull();
  });

  it("puts the caret after the last attribute, ready to type another", () => {
    const edit = imagesToMdx(image, 5, 5)!;

    expect(edit.text.slice(edit.caret)).toBe(" />");
    expect(edit.text.slice(0, edit.caret)).toBe('<Image src="app_data/trip-0123456789ab.png" alt="Route map"');
  });

  it("keeps a title", () => {
    expect(convert('![a](app_data/x-0123456789ab.png "The title")', 3)).toBe(
      '<Image src="app_data/x-0123456789ab.png" alt="a" title="The title" />',
    );
  });

  it("writes an empty alt as an empty alt", () => {
    expect(convert("![](app_data/x-0123456789ab.png)", 2)).toBe('<Image src="app_data/x-0123456789ab.png" alt="" />');
  });

  describe("with a selection", () => {
    const two = `${image}\n\ntext between\n\n![Second](https://example.com/b.png)`;

    it("converts every image it overlaps and keeps the text between them", () => {
      expect(convert(two, 0, two.length)).toBe(`${tag}\n\ntext between\n\n<Image src="https://example.com/b.png" alt="Second" />`);
    });

    it("converts only the images it reaches", () => {
      expect(convert(two, 0, 10)).toBe(`${tag}\n\ntext between\n\n![Second](https://example.com/b.png)`);
    });

    it("does not take an image that it merely touches", () => {
      expect(imagesToMdx(`${image} x`, image.length, image.length + 2)).toBeNull();
    });

    it("puts the caret in the last tag", () => {
      const edit = imagesToMdx(two, 0, two.length)!;

      expect(edit.text.slice(edit.caret)).toBe(" />");
    });
  });

  describe("text that is not an image", () => {
    it.each([
      ["a fenced code block", "```md\n![a](b.png)\n```", 8],
      ["an inline code span", "use `![a](b.png)` to embed", 8],
      ["a link", "[a](b.png)", 3],
      ["an address with a space", "![a](my file.png)", 3],
    ])("leaves %s alone", (_, text, at) => {
      expect(imagesToMdx(text, at, at)).toBeNull();
    });

    it("converts one after a closed fence", () => {
      expect(convert("```\ncode\n```\n![a](b.png)", 18)).toBe('```\ncode\n```\n<Image src="b.png" alt="a" />');
    });
  });

  describe("escaping", () => {
    it("undoes Markdown escapes in the alt text", () => {
      expect(convert("![a \\* b \\_c\\_](x.png)", 3)).toBe('<Image src="x.png" alt="a * b _c_" />');
    });

    it("writes quotes and ampersands so the attribute stays whole", () => {
      expect(convert('![Tom & "Jerry"](x.png "A \\"title\\"")', 3)).toBe(
        '<Image src="x.png" alt="Tom &amp; &quot;Jerry&quot;" title="A &quot;title&quot;" />',
      );
    });

    it("leaves a character reference that is already one", () => {
      expect(convert("![a &amp; b](x.png?a=1&amp;b=2)", 3)).toBe('<Image src="x.png?a=1&amp;b=2" alt="a &amp; b" />');
    });
  });

  describe("the preview", () => {
    afterEach(cleanup);

    it("shows the converted tag as the same picture, with the alt text intact", () => {
      const markdown = '![Tom & "Jerry" <3 {x}](app_data/x-0123456789ab.png)';
      render(<NoteMarkdown body={convert(markdown, 3)!} rehypePlugins={[]} />);

      const img = screen.getByAltText('Tom & "Jerry" <3 {x}');
      expect(img.getAttribute("src")).toBe("/app_data/x-0123456789ab.png");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
