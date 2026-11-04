// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

// The first highlight pulls in every highlight.js grammar, which is slow.
const LOAD_TIMEOUT_MS = 10_000;

function renderPreview(value: string) {
  return render(
    <MarkdownEditor noteId={7} value={value} onChange={vi.fn()} ratio={0.5} onRatioChange={vi.fn()} onRatioCommit={vi.fn()} />,
  );
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

describe("MarkdownEditor image preview", () => {
  afterEach(cleanup);

  it("renders a stored image through the web route", () => {
    renderPreview("![A diagram](app_data/trip-map-0123456789ab.png)");

    const img = screen.getByAltText("A diagram");
    expect(img.getAttribute("src")).toBe("/app_data/trip-map-0123456789ab.png");
  });

  it("shows any other image as written", () => {
    renderPreview("![logo](https://example.com/logo.png)");

    expect(screen.getByAltText("logo").getAttribute("src")).toBe("https://example.com/logo.png");
  });

  it("does not resolve a path that tries to leave app_data", () => {
    renderPreview("![x](app_data/../composition.db)");

    expect(screen.getByAltText("x").getAttribute("src")).toBe("app_data/../composition.db");
  });

  it("falls back to the alt text when the file is missing", () => {
    renderPreview("![A diagram](app_data/gone-0123456789ab.png)");

    fireEvent.error(screen.getByAltText("A diagram"));

    expect(screen.queryByRole("img", { name: "A diagram" })?.tagName).toBe("SPAN");
    expect(screen.getByText("Image not found: A diagram")).toBeDefined();
  });

  it("renders images alongside the rest of the note", () => {
    renderPreview("# Title\n\nText ![inline](app_data/a-0123456789ab.png) more text.");

    expect(screen.getByRole("heading", { name: "Title" })).toBeDefined();
    expect(screen.getByAltText("inline")).toBeDefined();
  });
});

describe("MarkdownEditor syntax highlighting", () => {
  afterEach(cleanup);

  const layer = (container: HTMLElement) => container.querySelector<HTMLElement>("[aria-hidden='true'] pre");
  const renderEditor = (value: string) =>
    render(
      <MarkdownEditor noteId={7} value={value} onChange={vi.fn()} ratio={0.5} onRatioChange={vi.fn()} onRatioCommit={vi.fn()} view="markdown" />,
    );

  it("draws the text again in colour under the textarea, hidden from assistive tech", () => {
    const { container } = renderEditor("# Title\n\nSome **bold** text");

    const pre = layer(container)!;
    expect(pre.textContent).toBe("# Title\n\nSome **bold** text​");
    expect(pre.querySelector(".md-heading")?.textContent).toBe("# Title");
    expect(pre.querySelector(".md-strong")?.textContent).toBe("**bold**");
    expect(pre.closest("[aria-hidden='true']")).not.toBeNull();
    // The textarea stays the one thing a user or a screen reader deals with.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("makes the textarea's own text transparent so only the coloured copy shows", () => {
    renderEditor("text");

    expect(screen.getByRole("textbox").className).toContain("text-transparent");
  });

  it("drops the layer, and shows the textarea's own text, for a very large note", () => {
    const { container } = renderEditor("a".repeat(100_001));

    expect(layer(container)).toBeNull();
    expect(screen.getByRole("textbox").className).not.toContain("text-transparent");
  });
});

describe("MarkdownEditor spellcheck", () => {
  afterEach(cleanup);

  it("lets the browser underline misspelled words while writing", () => {
    renderPreview("Hello");
    // jsdom has no `spellcheck` property, so check the attribute the browser reads.
    expect(screen.getByLabelText("Markdown editor").getAttribute("spellcheck")).toBe("true");
  });
});
