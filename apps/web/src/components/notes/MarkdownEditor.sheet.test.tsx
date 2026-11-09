// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorControls } from "./MarkdownEditor";
import { describeParity, type EditorDriver } from "./parityHarness";
import type { SheetEditSource } from "./SheetDialog";
import type { SheetSource } from "./mdx/sheetDraft";
import { importedHash } from "./mdx/sheetImport";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

const SAVED: SheetSource = { csv: "Item,Qty\nPens,12", formulas: "" };
const SAVED_WITH_FORMULAS: SheetSource = { csv: "Item,Qty\nPens,12\nTotal,12", formulas: "B3 =SUM(B2:B2)" };
let saving: SheetSource = SAVED;

const IMPORTED = { source: { csv: "Item,Qty\nPens,12", formulas: "" }, file: "budget.xlsx", sheet: "Q3", range: "A1:B2", imported: "0123456789ab" };

// The import dialog, too, is a stand-in: it can "import" a made-up range.
vi.mock("./SheetImportDialog", () => ({
  SheetImportDialog: ({ open, replacing, onImported, onClose }: { open: boolean; replacing?: unknown; onImported: (imported: typeof IMPORTED) => void; onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="import dialog" data-replacing={JSON.stringify(replacing ?? null)}>
        <button onClick={() => onImported(IMPORTED)}>stub import</button>
        <button onClick={onClose}>stub close import</button>
      </div>
    ) : null,
}));

// The dialog is tested on its own; here it is a stand-in that shows what it was opened for and can "save".
vi.mock("./SheetDialog", () => ({
  SheetDialog: ({ open, source, onSaved, onClose }: { open: boolean; source: SheetEditSource; onSaved: (source: SheetSource) => void; onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="sheet editor" data-source={JSON.stringify(source)}>
        <button onClick={() => onSaved(saving)}>stub save</button>
        <button onClick={onClose}>stub close</button>
      </div>
    ) : null,
}));

const FRONTMATTER = "---\ntitle: A\ndescription: ''\ntags: []\ncreatedAt: 2026-01-01\nupdatedAt: 2026-01-01\n---\n";
const TAG = "<Sheet>\n\n```csv\nItem,Qty\nPens,12\n```\n\n</Sheet>";
const SHEET = '<Sheet title="Q3">\n\n```csv\nUnits,Double\n10,20\n```\n\n```formulas\nB2 =A2*2\n```\n\n</Sheet>';
const TABLE = "| A | B |\n| --- | --- |\n| 1 | 2 |";

const dialog = () => screen.queryByRole("dialog", { name: "sheet editor" });
const sourceOf = () => JSON.parse(dialog()!.getAttribute("data-source")!) as SheetEditSource;
const save = () => fireEvent.click(screen.getByRole("button", { name: "stub save" }));

beforeEach(() => {
  saving = SAVED;
});
afterEach(cleanup);

describeParity("MarkdownEditor: the sheet editor", (scenario) => {
  const sheetShortcut = (editor: EditorDriver, init: KeyboardEventInit = {}) => editor.press("G", { shiftKey: true, metaKey: true, ...init });

  scenario("Cmd+Shift+G opens the sheet editor for a new sheet, and Ctrl+Shift+G does too", ({ render }) => {
    const editor = render({ initial: "Intro" });
    sheetShortcut(editor);
    expect(sourceOf()).toEqual({ kind: "new" });
    cleanup();

    const second = render({ initial: "Intro" });
    sheetShortcut(second, { metaKey: false, ctrlKey: true });
    expect(dialog()).not.toBeNull();
  });

  scenario("puts a new sheet at the caret, as a block of its own", async ({ render }) => {
    const editor = render({ initial: `${FRONTMATTER}One Two` });
    editor.select(FRONTMATTER.length + 4, FRONTMATTER.length + 4);
    sheetShortcut(editor);

    save();

    await waitFor(() => expect(editor.reported.at(-1)).toBe(`${FRONTMATTER}One \n\n${TAG}\n\nTwo`));
    expect(dialog()).toBeNull();
  });

  scenario("puts a new sheet after the frontmatter, at the end, when the caret is in the frontmatter", async ({ render }) => {
    const editor = render({ initial: `${FRONTMATTER}Body` });
    editor.select(0, 0);
    sheetShortcut(editor);

    save();

    await waitFor(() => expect(editor.reported.at(-1)).toBe(`${FRONTMATTER}Body\n\n${TAG}\n\n`));
  });

  scenario("writes the formulas block when the sheet has formulas", async ({ render }) => {
    saving = SAVED_WITH_FORMULAS;
    const editor = render({ initial: "Intro" });
    sheetShortcut(editor);

    save();

    await waitFor(() => expect(editor.reported.at(-1)).toContain("```formulas\nB3 =SUM(B2:B2)\n```"));
  });

  scenario("opens on the Markdown table the caret is in, and replaces the table with the sheet", async ({ render }) => {
    const editor = render({ initial: `${FRONTMATTER}Intro\n\n${TABLE}\n\nOutro` });
    const inTable = FRONTMATTER.length + "Intro\n\n".length + 2;
    editor.select(inTable, inTable);
    sheetShortcut(editor);

    expect(sourceOf()).toEqual({
      kind: "promote",
      rows: [
        ["A", "B"],
        ["1", "2"],
      ],
    });
    save();

    await waitFor(() => expect(editor.reported.at(-1)).toBe(`${FRONTMATTER}Intro\n\n${TAG}\n\nOutro`));
  });

  scenario("opens on the sheet the caret is in, and rewrites only that sheet's blocks", async ({ render }) => {
    const note = `${FRONTMATTER}Before\n\n${SHEET}\n\nAfter`;
    const editor = render({ initial: note });
    const inSheet = note.indexOf("Units,Double");
    editor.select(inSheet, inSheet);
    sheetShortcut(editor);

    expect(sourceOf()).toEqual({ kind: "edit", csv: "Units,Double\n10,20", formulas: "B2 =A2*2" });
    save();

    await waitFor(() => expect(editor.reported.at(-1)).toBe(`${FRONTMATTER}Before\n\n<Sheet title="Q3">\n\n\`\`\`csv\nItem,Qty\nPens,12\n\`\`\`\n\n</Sheet>\n\nAfter`));
  });

  scenario("says on the tag that the last row is a totals row when the sheet was saved so, and takes it off again", async ({ render }) => {
    saving = { ...SAVED, totals: true };
    const editor = render({ initial: "Intro" });
    sheetShortcut(editor);
    save();
    await waitFor(() => expect(editor.reported.at(-1)).toContain('<Sheet totals="true">'));

    const note = editor.text();
    const inSheet = note.indexOf("Item,Qty");
    editor.select(inSheet, inSheet);
    saving = SAVED;
    sheetShortcut(editor);
    expect(sourceOf()).toEqual({ kind: "edit", csv: "Item,Qty\nPens,12", formulas: "", totals: true });
    save();

    await waitFor(() => expect(editor.reported.at(-1)).toContain("<Sheet>\n"));
    expect(editor.reported.at(-1)).not.toContain("totals");
  });

  scenario("is opened from outside too, by the pane's Sheet button", ({ render }) => {
    const controls = createRef<MarkdownEditorControls>();
    render({ initial: "Intro", controls });

    act(() => controls.current?.editSheet());

    expect(sourceOf()).toEqual({ kind: "new" });
  });

  scenario("leaves the note as it was when closed without saving", ({ render }) => {
    const editor = render({ initial: "Intro" });
    sheetShortcut(editor);

    fireEvent.click(screen.getByRole("button", { name: "stub close" }));

    expect(editor.reported).toEqual([]);
    expect(editor.text()).toBe("Intro");
    expect(dialog()).toBeNull();
  });

  scenario("does not write a sheet over a note that changed while the editor was open, and says so", async ({ render }) => {
    const note = `Before\n\n${SHEET}\n\nAfter`;
    const editor = render({ initial: note });
    const inSheet = note.indexOf("Units,Double");
    editor.select(inSheet, inSheet);
    sheetShortcut(editor);
    const changed = note.replace("10,20", "11,22");
    editor.type(changed, 0);

    save();

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The note changed while the sheet was open"));
    expect(editor.text()).toBe(changed);
  });
});

describeParity("MarkdownEditor: Import from Excel", (scenario) => {
  const importDialog = () => screen.queryByRole("dialog", { name: "import dialog" });

  scenario("is opened from outside, by the pane's Excel button", ({ render }) => {
    const controls = createRef<MarkdownEditorControls>();
    render({ initial: "Intro", controls });

    act(() => controls.current?.importExcel());

    expect(importDialog()).not.toBeNull();
  });

  scenario("puts the imported sheet at the caret, as a block, with where it came from on its tag", async ({ render }) => {
    const controls = createRef<MarkdownEditorControls>();
    const editor = render({ initial: `${FRONTMATTER}One Two`, controls });
    editor.select(FRONTMATTER.length + 4, FRONTMATTER.length + 4);
    act(() => controls.current?.importExcel());

    fireEvent.click(screen.getByRole("button", { name: "stub import" }));

    await waitFor(() =>
      expect(editor.reported.at(-1)).toBe(
        `${FRONTMATTER}One \n\n<Sheet source="budget.xlsx" sheet="Q3" range="A1:B2" imported="0123456789ab">\n\n\`\`\`csv\nItem,Qty\nPens,12\n\`\`\`\n\n</Sheet>\n\nTwo`,
      ),
    );
    expect(importDialog()).toBeNull();
  });

  scenario("leaves the note as it was when closed without importing", ({ render }) => {
    const controls = createRef<MarkdownEditorControls>();
    const editor = render({ initial: "Intro", controls });
    act(() => controls.current?.importExcel());

    fireEvent.click(screen.getByRole("button", { name: "stub close import" }));

    expect(editor.reported).toEqual([]);
    expect(importDialog()).toBeNull();
  });
});

describeParity("MarkdownEditor: a range pasted from a spreadsheet", (scenario) => {
  const TSV = "Item\tQty\nPens\t12\nPaper\t3";
  const banner = () => screen.queryByRole("status");

  /** Pastes `clipboard` at the caret of a note, and puts the text in as the browser does right after the paste handler has run. */
  function pasteInto(editor: EditorDriver, note: string, at: number, clipboard: string) {
    editor.type(note, at);
    editor.select(at, at);
    editor.paste([], clipboard);
    editor.type(note.slice(0, at) + clipboard + note.slice(at), at + clipboard.length);
  }

  scenario("stays text, with an offer to make it a sheet", async ({ render }) => {
    const editor = render({ initial: "" });
    pasteInto(editor, "Intro\n\n", 7, TSV);

    await waitFor(() => expect(banner()?.textContent).toContain("3 rows by 2 columns"));
    expect(editor.text()).toBe(`Intro\n\n${TSV}`);
  });

  scenario("opens the sheet editor on the pasted cells, and puts the sheet in place of the text", async ({ render }) => {
    const editor = render({ initial: "" });
    pasteInto(editor, "Intro\n\n\nOutro", 7, TSV);
    await waitFor(() => expect(banner()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Make it a sheet" }));
    expect(sourceOf()).toEqual({
      kind: "promote",
      rows: [
        ["Item", "Qty"],
        ["Pens", "12"],
        ["Paper", "3"],
      ],
    });
    save();

    await waitFor(() => expect(editor.reported.at(-1)).toBe(`Intro\n\n${TAG}\n\nOutro`));
    expect(banner()).toBeNull();
  });

  scenario("is dropped by Keep as text, and by changing the note", async ({ render }) => {
    const editor = render({ initial: "" });
    pasteInto(editor, "", 0, TSV);
    await waitFor(() => expect(banner()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Keep as text" }));
    expect(banner()).toBeNull();
    expect(editor.text()).toBe(TSV);

    cleanup();
    const second = render({ initial: "" });
    pasteInto(second, "", 0, TSV);
    await waitFor(() => expect(banner()).not.toBeNull());
    second.type(`${TSV}!`);
    await waitFor(() => expect(banner()).toBeNull());
  });

  scenario("is not offered for ordinary text, for text indented with tabs, or for a paste into a code block", async ({ render }) => {
    const editor = render({ initial: "" });
    for (const clipboard of ["Just a sentence.", "Two\nlines", "\tindented\n\tcode"]) {
      pasteInto(editor, "", 0, clipboard);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(banner(), clipboard).toBeNull();
    }
    pasteInto(editor, "```\n\n```", 4, TSV);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(banner()).toBeNull();
  });
});

describe("MarkdownEditor: editing a sheet from the preview", () => {
  const note = `${FRONTMATTER}Intro\n\n${SHEET}\n\nMiddle\n\n${TAG}\n`;
  let latest = "";

  function Harness({ readOnly = false }: { readOnly?: boolean }) {
    const [value, setValue] = useState(note);
    return (
      <MarkdownEditor
        noteId={7}
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
        ratio={0.5}
        onRatioChange={vi.fn()}
        onRatioCommit={vi.fn()}
        readOnly={readOnly}
      />
    );
  }

  beforeEach(() => {
    latest = "";
  });

  it("opens the sheet editor on a sheet's blocks when its Edit button is pressed", () => {
    render(<Harness />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit sheet" })[0]);

    expect(sourceOf()).toEqual({ kind: "edit", csv: "Units,Double\n10,20", formulas: "B2 =A2*2" });
  });

  it("opens the sheet that was pressed, not the first", () => {
    render(<Harness />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit sheet" })[1]);

    expect(sourceOf()).toEqual({ kind: "edit", csv: "Item,Qty\nPens,12", formulas: "" });
  });

  it("writes what was saved into that sheet, and leaves the other one alone", async () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit sheet" })[1]);
    saving = { csv: "Item,Qty\nPens,13", formulas: "" };

    save();

    await waitFor(() => expect(latest).toBe(note.replace("Pens,12", "Pens,13")));
    expect(latest).toContain("B2 =A2*2");
  });

  it("has no Edit button on a note that cannot be changed", () => {
    render(<Harness readOnly />);

    expect(screen.queryByRole("button", { name: "Edit sheet" })).toBeNull();
  });
});

describe("MarkdownEditor: re-importing a sheet", () => {
  const BLOCKS = { csv: "Item,Qty\nPens,11", formulas: "" };
  const sheetTag = (attributes: string, blocks: SheetSource = BLOCKS) =>
    `<Sheet title="Q3"${attributes}>\n\n\`\`\`csv\n${blocks.csv}\n\`\`\`\n\n</Sheet>`;
  let latest = "";

  function Harness({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return (
      <MarkdownEditor
        noteId={7}
        value={value}
        onChange={(next) => {
          latest = next;
          setValue(next);
        }}
        ratio={0.5}
        onRatioChange={vi.fn()}
        onRatioCommit={vi.fn()}
      />
    );
  }
  const replacing = () => JSON.parse(importDialogEl().getAttribute("data-replacing")!);
  const importDialogEl = () => screen.getByRole("dialog", { name: "import dialog" });

  beforeEach(() => {
    latest = "";
  });

  it("opens on the sheet's own tag, and says the sheet is as it was imported when its fingerprint matches", async () => {
    const hash = await importedHash(BLOCKS);
    render(<Harness initial={`Intro\n\n${sheetTag(` source="budget.xlsx" sheet="Q3 budget" range="A1:B2" imported="${hash}"`)}\n`} />);

    fireEvent.click(await screen.findByRole("button", { name: "Re-import" }));

    await waitFor(() => expect(importDialogEl()).toBeTruthy());
    expect(replacing()).toEqual({ file: "budget.xlsx", sheet: "Q3 budget", range: "A1:B2", changed: false });
  });

  it("says the sheet has been changed when its fingerprint no longer matches, or it has none", async () => {
    const hash = await importedHash({ csv: "Item,Qty\nPens,12", formulas: "" });
    const { unmount } = render(<Harness initial={`${sheetTag(` source="budget.xlsx" sheet="Q3" range="A1:B2" imported="${hash}"`)}\n`} />);
    fireEvent.click(await screen.findByRole("button", { name: "Re-import" }));
    await waitFor(() => expect(replacing().changed).toBe(true));
    unmount();
    cleanup();

    render(<Harness initial={`${sheetTag(` source="budget.xlsx" sheet="Q3" range="A1:B2"`)}\n`} />);
    fireEvent.click(await screen.findByRole("button", { name: "Re-import" }));
    await waitFor(() => expect(replacing().changed).toBe(true));
  });

  it("replaces the sheet's blocks and its tag's source, sheet, range and fingerprint, and nothing else of the note", async () => {
    const hash = await importedHash(BLOCKS);
    const note = `Intro\n\n${sheetTag(` source="budget.xlsx" sheet="Q3 budget" range="A1:B2" imported="${hash}"`)}\n\nOutro\n`;
    render(<Harness initial={note} />);
    fireEvent.click(await screen.findByRole("button", { name: "Re-import" }));
    await waitFor(() => expect(importDialogEl()).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "stub import" }));

    await waitFor(() => expect(latest).not.toBe(""));
    expect(latest).toBe(`Intro\n\n${sheetTag(' source="budget.xlsx" sheet="Q3" range="A1:B2" imported="0123456789ab"', IMPORTED.source)}\n\nOutro\n`);
    expect(screen.queryByRole("dialog", { name: "import dialog" })).toBeNull();
  });

  it("has no Re-import on a sheet that did not come from Excel", () => {
    render(<Harness initial={`${sheetTag("")}\n`} />);

    expect(screen.queryByRole("button", { name: "Re-import" })).toBeNull();
  });
});
