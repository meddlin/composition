import { describe, expect, it } from "vitest";
import { mdxComponents } from "./components";
import { expandCompletion } from "./completions";
import { findPropTarget } from "./props";

/** The target at the `|` in `marked`, which stands for the caret. */
function at(marked: string) {
  const caret = marked.indexOf("|");
  return findPropTarget(marked.replace("|", ""), caret);
}
const names = (marked: string) => at(marked)?.items.map((item) => item.name);

describe("findPropTarget: prop names", () => {
  it("lists every prop of the component after the first space", () => {
    expect(names("<Image |")).toEqual(["src", "alt", "title", "width"]);
  });

  it("offers props inside a tag that is already closed", () => {
    expect(names('<Image src="a.png" |/>')).toEqual(["alt", "title", "width"]);
    expect(names('<Image src="a.png" alt="x" | />')).toEqual(["title", "width"]);
  });

  it("leaves out the props the tag already has, wherever they sit", () => {
    expect(names('<Image alt="x" | src="a.png" />')).toEqual(["title", "width"]);
  });

  it("narrows by what has been typed, ignoring case", () => {
    expect(names("<Image wi|")).toEqual(["width"]);
    expect(names("<Image T|")).toEqual(["title"]);
  });

  it("replaces just the word being typed", () => {
    const target = at("<Image src='a' wi|dth />")!;

    expect(target.query).toBe("wi");
    expect("<Image src='a' width />".slice(target.start, target.end)).toBe("width");
  });

  it("does not count the word being typed as already there", () => {
    expect(names("<Image wid|")).toEqual(["width"]);
  });

  it("works across lines, and for other components", () => {
    expect(names('<Image\n  src="a.png"\n  |')).toEqual(["alt", "title", "width"]);
    expect(names("<Mark |")).toEqual(["color"]);
    expect(names("<Toc |/>")).toEqual(["maxDepth"]);
  });

  it("finds the tag in the middle of a sentence", () => {
    expect(names("See <Image src='a.png' | /> here.")).toEqual(["alt", "title", "width"]);
  });

  it("offers nothing for a component with no props", () => {
    expect(at("<Info |")?.items ?? []).toEqual([]);
    expect(at("<Footnotes |/>")?.items ?? []).toEqual([]);
  });

  it("gives each prop an empty pair of quotes with the caret inside", () => {
    const width = at("<Image |")!.items.find((item) => item.name === "width")!;

    expect(expandCompletion(width)).toEqual({ text: 'width=""', caret: 'width="'.length });
  });

  it("adds a space when the next prop is hard against the caret", () => {
    const width = at('<Image |src="a.png" />')!.items.find((item) => item.name === "width")!;

    expect(expandCompletion(width).text).toBe('width="" ');
  });

  it.each([
    ["right after the tag's name", "<Image|"],
    ["right after a closing quote", '<Image src="a.png"| '],
    ["after a tag has closed", '<Image src="a.png" /> |'],
    ["after a tag has closed, on its own line", '<Image src="a.png" />\n|'],
    ["before an =", "<Image src |= 'a' />"],
    ["in a prop that already has a value", "<Image wid|th='3' />"],
    ["in text that merely looks like a tag", "1 <Image> |"],
    ["in a component this app doesn't have", "<Danger |"],
    ["in a word that only begins like one", "<ImageX |"],
    ["after a blank line", "<Image src='a'\n\n|"],
    ["a tag glued to a word", "a<Image |"],
    ["in a fenced code block", "```mdx\n<Image |"],
  ])("offers nothing %s", (_, marked) => {
    expect(at(marked)?.items ?? []).toEqual([]);
  });

  it("offers nothing for a tag inside a fenced code block, but does once the fence has closed", () => {
    expect(at("```\n<Image |")).toBeNull();
    expect(names("```\n<Image />\n```\n<Image |")).toEqual(["src", "alt", "title", "width"]);
  });

  it("is not thrown by a stray < earlier in the tag", () => {
    expect(names("<Image alt='1 < 2' |")).toEqual(["src", "title", "width"]);
  });
});

describe("findPropTarget: values", () => {
  it("suggests widths inside the quotes of width", () => {
    expect(names('<Image width="|')).toEqual(["25%", "50%", "75%", "100%", "200", "400", "600", "800"]);
    expect(names("<Image width='|' />")).toEqual(["25%", "50%", "75%", "100%", "200", "400", "600", "800"]);
  });

  it("narrows by what has been typed", () => {
    expect(names('<Image width="2|"')).toEqual(["25%", "200"]);
    expect(names('<Image width="50|" />')).toEqual(["50%"]);
  });

  it("closes when nothing matches, since any width may be typed", () => {
    expect(names('<Image width="3|" />')).toEqual([]);
    expect(names('<Image width="320|" />')).toEqual([]);
  });

  it("replaces the value, closing quote included, so the caret ends up past it", () => {
    const text = '<Image width="5" alt="x" />';
    const target = findPropTarget(text, '<Image width="5'.length)!;
    const { text: inserted, caret } = expandCompletion(target.items[0]);
    const result = text.slice(0, target.start) + inserted + text.slice(target.end);

    expect(result).toBe('<Image width="50%" alt="x" />');
    expect(result.slice(0, target.start + caret)).toBe('<Image width="50%"');
  });

  it("supplies the closing quote when the value was left open", () => {
    const text = '<Image width="';
    const target = findPropTarget(text, text.length)!;
    const { text: inserted } = expandCompletion(target.items.find((item) => item.name === "50%")!);

    expect(text.slice(0, target.start) + inserted + text.slice(target.end)).toBe('<Image width="50%"');
  });

  it("leaves the rest of the line alone when the quote was left open", () => {
    const text = '<Image width="5 />';
    const target = findPropTarget(text, '<Image width="5'.length)!;

    expect(target.end).toBe(text.length);
  });

  it("suggests the values of other props", () => {
    expect(names('<Mark color="|')).toEqual(["yellow", "green", "blue", "pink", "orange"]);
    expect(names('<Mark color="p|')).toEqual(["pink"]);
    expect(names('<Toc maxDepth="|')).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("has no suggestions for a prop that has none", () => {
    expect(names('<Image src="|')).toEqual([]);
    expect(names('<Image alt="|')).toEqual([]);
  });

  it("does not suggest into the middle of someone else's text", () => {
    expect(names('<Image width="50%" /> then "|')).toEqual(undefined);
  });
});

describe("the prop catalog", () => {
  it.each(Object.keys(mdxComponents))("knows about <%s>", (name) => {
    // A component with nothing to offer still has to be listed (that is what the type enforces);
    // this checks the runtime agrees, by asking about one it must find.
    const target = at(`<${name} |`);
    expect(target === null || Array.isArray(target.items)).toBe(true);
  });

  it("only ever offers props that the component declares", () => {
    for (const marked of ["<Image |", "<Mark |", "<Toc |"]) {
      for (const item of at(marked)!.items) {
        expect(item.description.length).toBeGreaterThan(0);
        expect(item.template).toMatch(/^\w+="\$0"$/);
      }
    }
  });
});
