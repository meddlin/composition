import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { service } from "./backend";
import { createSandbox, foregroundAt, frame, press, settle, type Rendered, type Sandbox } from "./testing";
import { PALETTES } from "./theme";

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox();
});
afterEach(async () => {
  await sandbox.dispose();
});

const { dark } = { dark: PALETTES.dark };

/** Opens a note holding `content` (below its frontmatter) as a preview in a pane. */
async function open(content: string): Promise<Rendered> {
  const note = await service.createNote("Guide", null);
  await service.saveNoteContent(note.id, `---\ntitle: Guide\n---\n\n${content}`);
  const app = await sandbox.mount({ width: 140, height: 50 });
  await press(app, "RETURN", {}, 500); // a new pane starts as a split
  await press(app, "t", { ctrl: true }); // editor
  await press(app, "t", { ctrl: true }); // preview
  await settle(app, 1500); // the Markdown, and then highlight.js, are loaded and run off the render
  return app;
}

/** The text color of `text` as drawn on screen. */
function colorOf(app: Rendered, text: string): string {
  const rows = frame(app).split("\n");
  const row = rows.findIndex((line) => line.includes(text));
  if (row < 0) throw new Error(`"${text}" is not on screen:\n${frame(app)}`);
  return foregroundAt(app, row, rows[row].indexOf(text));
}

describe("code blocks in the preview", () => {
  it("colors a fenced block by language, in the palette's syntax colors", async () => {
    const app = await open('```ts\nconst answer = 42; // yes\nconst name = "Ada";\n```');

    expect(frame(app)).toContain('const name = "Ada";'); // the code is shown, not the fence
    expect(frame(app)).not.toContain("```");
    expect(colorOf(app, "const answer")).toBe(dark.syntax.keyword);
    expect(colorOf(app, "42")).toBe(dark.syntax.number);
    expect(colorOf(app, "// yes")).toBe(dark.syntax.comment);
    expect(colorOf(app, '"Ada"')).toBe(dark.syntax.string);
  });

  it("colors languages OpenTUI has no grammar for, such as Python and Rust", async () => {
    const app = await open('```python\ndef greet(name):\n    return "hi"\n```\n\n```rust\nfn main() {}\n```');

    expect(colorOf(app, "def greet")).toBe(dark.syntax.keyword);
    expect(colorOf(app, '"hi"')).toBe(dark.syntax.string);
    expect(colorOf(app, "fn main")).toBe(dark.syntax.keyword);
  });

  it("leaves a fence with no language, and one highlight.js doesn't know, as plain text", async () => {
    const app = await open("```\nconst plain = 1;\n```\n\n```nonesuch\nconst other = 2;\n```");

    expect(frame(app)).toContain("const plain = 1;");
    expect(colorOf(app, "const plain")).toBe(dark.foreground);
    expect(colorOf(app, "const other")).toBe(dark.foreground);
  });

  it("colors code in a panel", async () => {
    const app = await open("<Info>\n\n```js\nconst a = 1;\n```\n\n</Info>");

    expect(colorOf(app, "const a")).toBe(dark.syntax.keyword);
  });
});
