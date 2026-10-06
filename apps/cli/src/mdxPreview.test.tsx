import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listNotes, service } from "./backend";
import { PANEL_TINT } from "./components/Preview";
import { AUTOSAVE_DELAY_MS } from "./components/Pane";
import { backgroundAt, createSandbox, frame, press, settle, sleep, type Rendered, type Sandbox } from "./testing";
import { mix, PALETTES } from "./theme";

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = createSandbox();
});
afterEach(async () => {
  await sandbox.dispose();
});

const dark = PALETTES.dark;
const infoTint = mix(dark.surface, dark.primary, PANEL_TINT);
const warningTint = mix(dark.surface, dark.warning, PANEL_TINT);

/** Opens a note holding `content` (below its frontmatter) in a pane, as a preview or as editor and preview. */
async function open(content: string, view: "preview" | "split" = "preview"): Promise<Rendered> {
  const note = await service.createNote("Guide", null);
  await service.saveNoteContent(note.id, `---\ntitle: Guide\n---\n\n${content}`);
  const app = await sandbox.mount({ width: 140, height: 50 });
  await press(app, "RETURN", {}, 500); // a new pane starts as a split
  if (view === "preview") {
    await press(app, "t", { ctrl: true }); // editor
    await press(app, "t", { ctrl: true }); // preview
  }
  await settle(app, 1200); // the Markdown is drawn on a worker
  return app;
}

/** Where `text` is on screen. */
function find(app: Rendered, text: string): { row: number; column: number } {
  const rows = frame(app).split("\n");
  const row = rows.findIndex((line) => line.includes(text));
  if (row < 0) throw new Error(`"${text}" is not on screen:\n${frame(app)}`);
  return { row, column: rows[row].indexOf(text) };
}

const bgOf = (app: Rendered, text: string) => {
  const { row, column } = find(app, text);
  return backgroundAt(app, row, column);
};

describe("MDX components in the preview", () => {
  it("draws <Info> as a labelled, tinted panel with its Markdown rendered inside", async () => {
    const app = await open("Before.\n\n<Info>\n\nStaging resets **nightly**.\n\n- back up first\n- then deploy\n\n</Info>\n\nAfter.");

    const screen = frame(app);
    expect(screen).toContain("╭─ Info ");
    expect(screen).toContain("Staging resets nightly."); // the ** are not shown: it was rendered
    expect(screen).toContain("- back up first");
    expect(screen).not.toContain("<Info>");
    expect(bgOf(app, "Staging resets")).toBe(infoTint);
    expect(bgOf(app, "- then deploy")).toBe(infoTint);
    expect(bgOf(app, "Before.")).toBe(dark.surface);
    expect(bgOf(app, "After.")).toBe(dark.surface);
  });

  it("draws <Warning> the same way, in the warning color", async () => {
    const app = await open("<Warning>\n\nThis **deletes** every note.\n\n</Warning>");

    expect(frame(app)).toContain("╭─ Warning ");
    expect(frame(app)).toContain("This deletes every note.");
    expect(bgOf(app, "This deletes")).toBe(warningTint);
    expect(warningTint).not.toBe(infoTint);
  });

  it("draws a one-line <Info>text</Info> as a panel", async () => {
    const app = await open("<Info>Remember **this**.</Info>");

    expect(frame(app)).toContain("╭─ Info ");
    expect(frame(app)).toContain("Remember this.");
  });

  it("draws a panel inside a panel", async () => {
    const app = await open("<Info>\n\nouter\n\n<Warning>\n\ninner\n\n</Warning>\n\n</Info>");

    expect(frame(app)).toContain("╭─ Info ");
    expect(frame(app)).toContain("╭─ Warning ");
    expect(bgOf(app, "outer")).toBe(infoTint);
    expect(bgOf(app, "inner")).toBe(warningTint);
  });

  it("draws <Toc> as the note's headings, nested, down to maxDepth", async () => {
    const app = await open('<Toc maxDepth="2" />\n\n# Deploying\n\n## Careful\n\n### Too deep\n\n# Rollback');

    const screen = frame(app);
    expect(screen).toContain("─ Contents ");
    expect(screen).toContain("• Deploying");
    expect(screen).toContain("  • Careful");
    expect(screen).toContain("• Rollback");
    expect(screen).not.toContain("• Too deep");
    expect(screen).toContain("Too deep"); // the heading itself is still in the note
  });

  it("says when <Toc> has no headings to list", async () => {
    const app = await open("<Toc />\n\nJust prose.");

    expect(frame(app)).toContain("No headings yet.");
  });

  it("shows an <Image> the way it shows a Markdown image: by its alt text", async () => {
    const app = await open('<Image src="app_data/route-map.png" alt="Route map" />\n\n![Same](app_data/same.png)');

    expect(frame(app)).toContain("Route map");
    expect(frame(app)).toContain("Same");
    expect(frame(app)).not.toContain("<Image");
  });

  it("leaves a note without components as plain Markdown, stray < and { included", async () => {
    const app = await open("Plain **text**, and if a < b then {x}.\n\n# Heading");

    const screen = frame(app);
    expect(screen).toContain("Plain text, and if a < b then {x}.");
    expect(screen).not.toContain("Couldn’t render");
    expect(screen).not.toContain("Contents");
  });

  it("says what is wrong with a half-typed tag, above the note as plain Markdown", async () => {
    const app = await open("# Deploying\n\n<Info>\n\nstill typing");

    const screen = frame(app);
    expect(screen).toContain("Couldn’t render this note’s components:");
    expect(screen).toContain("Expected a closing tag for `<Info>` (4:1-4:7).");
    expect(screen).toContain("plain Markdown."); // the notice wraps, so only its tail is on one row
    expect(screen).toContain("still typing"); // the preview is not blank
  });

  it("refuses an unknown tag and {expressions}, as the web preview does", async () => {
    const unknown = await open("<Info>\n\nfine\n\n</Info>\n\n<Banner />");
    expect(frame(unknown)).toContain("Unknown component <Banner>.");

    const expression = await open("<Info>{1 + 1}</Info>");
    expect(frame(expression)).toContain("{expressions} are not supported.");
  });

  it("follows the editor: a half-typed tag shows the notice, closing it makes the panel, and a new heading reaches the <Toc>", async () => {
    const app = await open("<Toc />\n\n# One\n\n<Info>\n\nhello", "split");
    expect(frame(app)).toContain("Couldn’t render this note’s components:");
    expect(frame(app)).not.toContain("╭─ Info ");

    // The cursor starts at the top of the note; the end of the note is where the typing goes.
    for (let i = 0; i < 20; i++) await press(app, "ARROW_DOWN", {}, 20);
    await press(app, "e", { ctrl: true });
    await app.mockInput.typeText("\n\n</Info>\n\n## Added");
    await settle(app, 1200);

    const screen = frame(app);
    expect(screen).not.toContain("Couldn’t render this note’s components:");
    expect(screen).toContain("╭─ Info ");
    expect(screen).toContain("• One");
    expect(screen).toContain("  • Added");

    // And what was typed is what gets saved, tags and all.
    await sleep(AUTOSAVE_DELAY_MS + 400);
    expect(listNotes().find((n) => n.title === "Guide")?.content).toContain("<Info>\n\nhello\n\n</Info>\n\n## Added");
  });
});
