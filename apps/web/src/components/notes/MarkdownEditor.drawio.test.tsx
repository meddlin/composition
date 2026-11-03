// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawioSource } from "./DrawioDialog";
import { MarkdownEditor, type MarkdownEditorControls } from "./MarkdownEditor";
import { describeParity, type EditorDriver } from "./parityHarness";

vi.mock("@/lib/composition/client", () => ({ saveImage: vi.fn() }));

// The dialog is tested on its own; here it is a stand-in that shows what it was opened for and can "save".
vi.mock("./DrawioDialog", () => ({
  DrawioDialog: ({ open, source, onSaved, onClose }: { open: boolean; source: DrawioSource; onSaved: (name: string) => void; onClose: () => void }) =>
    open ? (
      <div role="dialog" aria-label="diagram editor" data-source={JSON.stringify(source)}>
        <button onClick={() => onSaved("saved-0123456789ab.png")}>stub save</button>
        <button onClick={onClose}>stub close</button>
      </div>
    ) : null,
}));

const FRONTMATTER = "---\ntitle: A\ndescription: ''\ntags: []\ncreatedAt: 2026-01-01\nupdatedAt: 2026-01-01\n---\n";
const NEW_TAG = '<Drawio src="app_data/saved-0123456789ab.png" alt="Diagram" />';

let latest = "";
function Harness({ initial, controls }: { initial: string; controls?: React.Ref<MarkdownEditorControls> }) {
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
      controls={controls}
    />
  );
}

const editor = () => screen.getByLabelText<HTMLTextAreaElement>("Markdown editor");
const dialog = () => screen.queryByRole("dialog", { name: "diagram editor" });
const sourceOf = () => JSON.parse(dialog()!.getAttribute("data-source")!) as DrawioSource;

beforeEach(() => {
  latest = "";
});
afterEach(cleanup);

// New diagrams, in the plain Markdown editor and the live one.
describeParity("MarkdownEditor: new diagrams", (scenario) => {
  const diagramShortcut = (editor: EditorDriver, init: KeyboardEventInit = {}) =>
    editor.press("D", { shiftKey: true, metaKey: true, ...init });

  scenario("Cmd+Shift+D opens the diagram editor for a new diagram", ({ render }) => {
    const editor = render({ initial: "Intro" });

    diagramShortcut(editor);

    expect(sourceOf()).toEqual({ kind: "new" });
  });

  scenario("also answers to Ctrl+Shift+D", ({ render }) => {
    const editor = render({ initial: "Intro" });

    diagramShortcut(editor, { metaKey: false, ctrlKey: true });

    expect(dialog()).not.toBeNull();
  });

  scenario("puts the saved diagram at the caret, as a block of its own", ({ render }) => {
    const editor = render({ initial: `${FRONTMATTER}One Two` });
    editor.select(FRONTMATTER.length + 4, FRONTMATTER.length + 4);
    diagramShortcut(editor);

    fireEvent.click(screen.getByRole("button", { name: "stub save" }));

    expect(editor.reported.at(-1)).toBe(`${FRONTMATTER}One \n\n${NEW_TAG}\n\nTwo`);
    expect(dialog()).toBeNull();
  });

  scenario("goes after the frontmatter, at the end, when the editor was never clicked in (the caret is at 0)", ({ render }) => {
    const editor = render({ initial: `${FRONTMATTER}Body` });
    editor.select(0, 0);
    diagramShortcut(editor);

    fireEvent.click(screen.getByRole("button", { name: "stub save" }));

    expect(editor.reported.at(-1)).toBe(`${FRONTMATTER}Body\n\n${NEW_TAG}\n\n`);
  });

  scenario("is opened from outside too, by the pane's Diagram button", ({ render }) => {
    const controls = createRef<MarkdownEditorControls>();
    render({ initial: "Intro", controls });

    act(() => controls.current?.insertDiagram());

    expect(sourceOf()).toEqual({ kind: "new" });
  });

  scenario("leaves the note as it was when closed without saving", ({ render }) => {
    const editor = render({ initial: "Intro" });
    diagramShortcut(editor);

    fireEvent.click(screen.getByRole("button", { name: "stub close" }));

    expect(editor.reported).toEqual([]); // never changed
    expect(editor.text()).toBe("Intro");
    expect(dialog()).toBeNull();
  });
});

describe("MarkdownEditor: editing a diagram from the preview", () => {
  const note = `${FRONTMATTER}Text\n\n<Drawio src="app_data/flow-0123456789ab.png" alt="Flow" />\n\nMore\n\n<Drawio src="app_data/flow-0123456789ab.png" alt="Again" />\n\n<Drawio src="app_data/other-0123456789ab.png" alt="Other" />\n`;

  it("opens the diagram editor on the stored file when a diagram's Edit button is pressed", () => {
    render(<Harness initial={note} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit diagram" })[0]);

    expect(sourceOf()).toEqual({ kind: "edit", name: "flow-0123456789ab.png" });
  });

  it("points every tag that showed the old file at the new one, and no other", () => {
    render(<Harness initial={note} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit diagram" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "stub save" }));

    expect(latest).toBe(note.replaceAll("flow-0123456789ab.png", "saved-0123456789ab.png"));
    expect(latest).toContain("other-0123456789ab.png");
    expect(dialog()).toBeNull();
  });

  it("leaves the note alone when the diagram was saved unchanged (the same file)", () => {
    const same = note.replaceAll("flow-0123456789ab.png", "saved-0123456789ab.png");
    render(<Harness initial={same} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit diagram" })[0]);

    fireEvent.click(screen.getByRole("button", { name: "stub save" }));

    expect(latest).toBe(""); // never changed
    expect(editor().value).toBe(same);
  });
});
