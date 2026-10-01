// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveImage } from "@/lib/composition/client";
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

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("MarkdownEditor images", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(saveImage).mockReset();
  });

  // Holds the text the way NotesApp does, so a paste's edits flow back into the textarea.
  function Harness({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return (
      <MarkdownEditor noteId={7} value={value} onChange={setValue} ratio={0.5} onRatioChange={vi.fn()} onRatioCommit={vi.fn()} />
    );
  }

  function paste(textarea: HTMLTextAreaElement, files: File[], text = "") {
    return fireEvent.paste(textarea, {
      clipboardData: { files, getData: (type: string) => (type === "text/plain" ? text : "") },
    });
  }

  const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
  const pngFile = (name = "image.png") => new File([PNG_BYTES], name, { type: "image/png" });

  it("saves a pasted image against the note and inserts Markdown for it at the caret", async () => {
    vi.mocked(saveImage).mockResolvedValue({ name: "trip-image-0123456789ab.png" });
    render(<Harness initial="before after" />);
    editor().setSelectionRange(7, 7);

    const notCancelled = paste(editor(), [pngFile()]);

    expect(notCancelled).toBe(false);
    await waitFor(() => expect(editor().value).toBe("before ![image](app_data/trip-image-0123456789ab.png)after"));
    expect(saveImage).toHaveBeenCalledWith({ noteId: 7, fileName: "image.png", data: PNG_BYTES });
  });

  it("shows a placeholder while the upload is in flight", async () => {
    let finish: (result: { name: string }) => void = () => {};
    vi.mocked(saveImage).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<Harness initial="" />);

    paste(editor(), [pngFile()]);

    expect(editor().value).toMatch(/^\[Uploading image \(\d+\)…\]$/);
    finish({ name: "a-image-0123456789ab.png" });
    await waitFor(() => expect(editor().value).toBe("![image](app_data/a-image-0123456789ab.png)"));
  });

  it("replaces the selected text", async () => {
    vi.mocked(saveImage).mockResolvedValue({ name: "n-image-0123456789ab.png" });
    render(<Harness initial="keep DROP keep" />);
    editor().setSelectionRange(5, 9);

    paste(editor(), [pngFile()]);

    await waitFor(() => expect(editor().value).toBe("keep ![image](app_data/n-image-0123456789ab.png) keep"));
  });

  it("inserts several pasted images one after another", async () => {
    vi.mocked(saveImage).mockImplementation(async ({ fileName }) => ({ name: `n-${fileName}` }));
    render(<Harness initial="" />);

    paste(editor(), [pngFile("a.png"), pngFile("b.png")]);

    await waitFor(() => expect(editor().value).toBe("![a](app_data/n-a.png)![b](app_data/n-b.png)"));
  });

  it("removes the placeholder and says why when the image is refused", async () => {
    vi.mocked(saveImage).mockResolvedValue({ error: "Only PNG, JPEG, GIF, and WebP images are supported." });
    render(<Harness initial="text" />);
    editor().setSelectionRange(4, 4);

    paste(editor(), [pngFile()]);

    await waitFor(() => expect(editor().value).toBe("text"));
    expect(screen.getByRole("alert").textContent).toBe("Only PNG, JPEG, GIF, and WebP images are supported.");
  });

  it("recovers when the upload itself fails", async () => {
    vi.mocked(saveImage).mockRejectedValue(new Error("network"));
    render(<Harness initial="" />);

    paste(editor(), [pngFile()]);

    await waitFor(() => expect(editor().value).toBe(""));
    expect(screen.getByRole("alert").textContent).toBe("Could not save the image.");
  });

  it("does not upload an image over the size limit", () => {
    render(<Harness initial="" />);
    const huge = pngFile();
    Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });

    paste(editor(), [huge]);

    expect(saveImage).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/at most 10 MB/);
    expect(editor().value).toBe("");
  });

  it("leaves an ordinary text paste to the browser", () => {
    render(<Harness initial="" />);

    expect(paste(editor(), [], "just text")).toBe(true);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("prefers the text when the clipboard holds both text and a picture of it", () => {
    render(<Harness initial="" />);

    expect(paste(editor(), [pngFile()], "A1\tB1")).toBe(true);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("ignores pasted files that aren't images", () => {
    render(<Harness initial="" />);

    expect(paste(editor(), [new File(["x"], "notes.txt", { type: "text/plain" })])).toBe(true);
    expect(saveImage).not.toHaveBeenCalled();
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
