// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { all } from "lowlight";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteMarkdown } from "./NoteMarkdown";
import { useCodeHighlighting } from "./useCodeHighlighting";

function Preview({ body }: { body: string }) {
  const rehypePlugins = useCodeHighlighting(body);
  return <NoteMarkdown body={body} rehypePlugins={rehypePlugins} />;
}

const note = (n: number) => `Note ${n}\n\n\`\`\`js\nconst x = ${n};\n\`\`\`\n`;

describe("useCodeHighlighting", () => {
  afterEach(cleanup);

  it("highlights a fenced block, and registers the languages once however often the preview renders", async () => {
    // Registering a language runs its definition, so this counts how often highlighting is set up. The module keeps
    // what it loaded, so this has to be the first test to render a fence.
    const registered = vi.spyOn(all, "javascript");

    const { container, rerender } = render(<Preview body={note(1)} />);
    await waitFor(() => expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const"), { timeout: 5000 });

    // react-markdown builds a new processor on every render, which runs each plugin's setup again.
    for (let n = 2; n <= 6; n++) rerender(<Preview body={note(n)} />);

    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(registered).toHaveBeenCalledTimes(1);
  });

  it("leaves a note without a fence alone", () => {
    const { container } = render(<Preview body="No code here." />);

    expect(container.querySelector(".hljs")).toBeNull();
  });
});
