// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteMarkdown } from "./NoteMarkdown";
import { useCodeHighlighting } from "./useCodeHighlighting";

function Preview({ body }: { body: string }) {
  const rehypePlugins = useCodeHighlighting(body);
  return <NoteMarkdown body={body} rehypePlugins={rehypePlugins} />;
}

const NO_PLUGINS: never[] = [];

/** Each `.code-line` of the first code block: its number, whether it is highlighted, and its text. */
function lines(container: HTMLElement) {
  return [...container.querySelectorAll("pre code .code-line")].map((line) => ({
    number: line.getAttribute("data-line"),
    highlighted: line.hasAttribute("data-highlighted"),
    // Each line ends with its line break.
    text: line.textContent?.replace(/\n$/, ""),
  }));
}

describe("code block line numbers and highlights in Preview", () => {
  afterEach(cleanup);

  it("numbers lines from the start line and highlights by the numbers shown, outside numbers ignored", () => {
    const body = "```text showLineNumbers=107 {50,109,110-111,200}\na\nb\nc\nd\n```\n";
    const { container } = render(<NoteMarkdown body={body} rehypePlugins={NO_PLUGINS} />);

    expect(lines(container)).toEqual([
      { number: "107", highlighted: false, text: "a" },
      { number: "108", highlighted: false, text: "b" },
      { number: "109", highlighted: true, text: "c" },
      { number: "110", highlighted: true, text: "d" },
    ]);
    const code = container.querySelector("pre code")!;
    expect(code.hasAttribute("data-line-numbers")).toBe(true);
    expect(code.getAttribute("data-digits")).toBe("3");
    // Copying the block copies the code alone, line breaks included.
    expect(code.textContent).toBe("a\nb\nc\nd\n");
  });

  it("highlights without numbers", () => {
    const { container } = render(<NoteMarkdown body={"```text {2}\na\nb\n```\n"} rehypePlugins={NO_PLUGINS} />);

    expect(lines(container)).toEqual([
      { number: null, highlighted: false, text: "a" },
      { number: null, highlighted: true, text: "b" },
    ]);
    expect(container.querySelector("pre code")!.hasAttribute("data-line-numbers")).toBe(false);
  });

  it("leaves a fence with no options as it was", () => {
    const { container } = render(<NoteMarkdown body={"```text title=x\na\nb\n```\n"} rehypePlugins={NO_PLUGINS} />);

    expect(container.querySelector(".code-line")).toBeNull();
    expect(container.querySelector("pre code")!.textContent).toBe("a\nb\n");
  });

  it("does not take an option for the language when the fence names none", () => {
    const { container } = render(<NoteMarkdown body={"``` {1}\na\n```\n"} rehypePlugins={NO_PLUGINS} />);

    const code = container.querySelector("pre code")!;
    expect(code.className).not.toContain("language-");
    expect(lines(container)).toEqual([{ number: null, highlighted: true, text: "a" }]);
  });

  it("keeps the syntax colours, cutting a colour that crosses a line break into one per line", async () => {
    const body = "```js showLineNumbers {2}\nconst a = 1; /* one\ntwo */ let b;\n```\n";
    const { container } = render(<Preview body={body} />);
    await waitFor(() => expect(container.querySelector(".hljs-keyword")).not.toBeNull(), { timeout: 5000 });

    const [first, second] = [...container.querySelectorAll("pre code .code-line")];
    expect(first.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(first.querySelector(".hljs-comment")?.textContent).toBe("/* one");
    expect(second.querySelector(".hljs-comment")?.textContent).toBe("two */");
    expect(second.querySelector(".hljs-keyword")?.textContent).toBe("let");
    expect(second.hasAttribute("data-highlighted")).toBe(true);
    expect(container.querySelector("pre code")!.textContent).toBe("const a = 1; /* one\ntwo */ let b;\n");
  });

  it("works in a note that uses an MDX component, inside the component too", () => {
    const body = '```text showLineNumbers=5\na\n```\n\n<Info>\n\n```text {1}\nb\n```\n\n</Info>\n';
    const { container } = render(<NoteMarkdown body={body} rehypePlugins={NO_PLUGINS} />);

    const blocks = container.querySelectorAll("pre code");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].querySelector(".code-line")?.getAttribute("data-line")).toBe("5");
    expect(blocks[1].querySelector(".code-line")?.hasAttribute("data-highlighted")).toBe(true);
  });

  it("leaves a chart's data as it was when its block has options", () => {
    const body = '<Chart type="bar">\n\n```csv showLineNumbers {2}\nname,value\na,3\nb,5\n```\n\n</Chart>\n';
    const plain = '<Chart type="bar">\n\n```csv\nname,value\na,3\nb,5\n```\n\n</Chart>\n';
    const label = (note: string) => {
      const { container } = render(<NoteMarkdown body={note} rehypePlugins={NO_PLUGINS} />);
      const found = container.querySelector('[aria-label^="Chart"]')?.getAttribute("aria-label");
      cleanup();
      return found;
    };
    expect(label(body)).toBe("Chart: bar chart of value by name, 2 rows");
    expect(label(body)).toBe(label(plain));
  });
});
