// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

// The first highlight pulls in every highlight.js grammar, which is slow.
const LOAD_TIMEOUT_MS = 10_000;

function renderPreview(value: string) {
  return render(<MarkdownEditor value={value} onChange={vi.fn()} />);
}

const tokens = (el: Element) => el.querySelectorAll("[class*='hljs-']");

describe("MarkdownEditor code highlighting", () => {
  afterEach(cleanup);

  it("highlights a fenced block by its language tag", async () => {
    const { container } = renderPreview("```ts\nconst x: number = 1;\n```");

    await waitFor(
      () => expect(container.querySelector("code.language-ts .hljs-keyword")?.textContent).toBe("const"),
      { timeout: LOAD_TIMEOUT_MS },
    );
  });

  it("supports languages beyond the common set", async () => {
    const { container } = renderPreview("```python\ndef greet():\n    return 'hi'\n```\n\n```haskell\nmain = putStrLn \"hi\"\n```");

    await waitFor(
      () => {
        expect(tokens(container.querySelector("code.language-python")!).length).toBeGreaterThan(0);
        expect(tokens(container.querySelector("code.language-haskell")!).length).toBeGreaterThan(0);
      },
      { timeout: LOAD_TIMEOUT_MS },
    );
  });

  it("leaves a fence with no language tag as plain text", async () => {
    const { container } = renderPreview("```ts\nconst x = 1;\n```\n\n```\nconst y = 2;\n```");

    // Wait for the tagged block to upgrade so the untagged check is not racing the load.
    await waitFor(() => expect(container.querySelector("code.language-ts .hljs-keyword")).not.toBeNull(), {
      timeout: LOAD_TIMEOUT_MS,
    });

    const untagged = [...container.querySelectorAll("pre code")].find((el) => !el.className.includes("language-"));
    expect(untagged?.textContent).toBe("const y = 2;\n");
    expect(tokens(untagged!)).toHaveLength(0);
  });

  it("renders an unknown language tag as plain text without throwing", async () => {
    const { container } = renderPreview("```ts\nconst x = 1;\n```\n\n```notalang\nfoo bar\n```");

    await waitFor(() => expect(container.querySelector("code.language-ts .hljs-keyword")).not.toBeNull(), {
      timeout: LOAD_TIMEOUT_MS,
    });

    const unknown = container.querySelector("code.language-notalang")!;
    expect(unknown.textContent).toBe("foo bar\n");
    expect(tokens(unknown)).toHaveLength(0);
  });

  it("does not highlight inline code", async () => {
    const { container } = renderPreview("Use `const x = 1` inline.\n\n```ts\nconst y = 2;\n```");

    await waitFor(() => expect(container.querySelector("pre .hljs-keyword")).not.toBeNull(), {
      timeout: LOAD_TIMEOUT_MS,
    });

    const inline = container.querySelector("p code")!;
    expect(inline.textContent).toBe("const x = 1");
    expect(tokens(inline)).toHaveLength(0);
  });

  it("still renders the frontmatter card and markdown around code", () => {
    renderPreview("---\ntitle: Hello\n---\n# Heading\n\nSome text.");

    expect(screen.getByRole("heading", { name: "Heading" })).toBeDefined();
    expect(screen.getByText("Some text.")).toBeDefined();
  });
});
