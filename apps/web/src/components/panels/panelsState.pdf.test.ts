import { describe, expect, it } from "vitest";
import { KINDS, pdfDocumentIdOf, type NotePanelState, type PdfPanelState } from "./kinds";
import { panelIds } from "./layoutTree";
import { MAIN_WINDOW, focusPanel, focusedPanelId, initialPanels, openNote, openPdfPair, setPanelKind, splitPanel, type PanelsState } from "./panelsState";

function counter() {
  let n = 0;
  return () => `p${++n}`;
}

const start = () => {
  const newId = counter();
  return { panels: initialPanels(newId), newId };
};
const kindsOf = (panels: PanelsState, windowId = MAIN_WINDOW) => panelIds(panels.windows[windowId].layout).map((id) => panels.byId[id].kind);
const focused = (panels: PanelsState, windowId = MAIN_WINDOW) => panels.byId[focusedPanelId(panels.windows[windowId])];
const noteIn = (panels: PanelsState, id: string) => (panels.byId[id].state as NotePanelState).noteId;

describe("opening a note that owns a PDF", () => {
  it("shows the note, and its PDF to the left of it, which is focused", () => {
    const { panels, newId } = start();

    const opened = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);

    const ids = panelIds(opened.windows[MAIN_WINDOW].layout);
    expect(kindsOf(opened)).toEqual(["pdf", "note"]);
    expect(opened.byId[ids[0]].state).toEqual({ documentId: 70 } satisfies PdfPanelState);
    expect(noteIn(opened, ids[1])).toBe(7);
    expect(focused(opened).kind).toBe("pdf");
  });

  it("puts the note where picking it would, in the note panel that is there", () => {
    const { panels, newId } = start();
    const withNote = openNote(panels, MAIN_WINDOW, 1, newId);

    const opened = openPdfPair(withNote, MAIN_WINDOW, 7, 70, newId);

    expect(kindsOf(opened)).toEqual(["pdf", "note"]);
    expect(noteIn(opened, panelIds(opened.windows[MAIN_WINDOW].layout)[1])).toBe(7);
  });

  it("only focuses the PDF when the window already shows it, and makes no second note panel", () => {
    const { panels, newId } = start();
    const once = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);
    const elsewhere = focusPanel(once, panelIds(once.windows[MAIN_WINDOW].layout)[1]);

    const again = openPdfPair(elsewhere, MAIN_WINDOW, 7, 70, newId);

    expect(kindsOf(again)).toEqual(["pdf", "note"]);
    expect(focused(again).kind).toBe("pdf");
  });

  it("opens each PDF beside its own note, and keeps the others where they are", () => {
    const { panels, newId } = start();
    const first = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);

    const second = openPdfPair(first, MAIN_WINDOW, 8, 80, newId);

    const ids = panelIds(second.windows[MAIN_WINDOW].layout);
    expect(ids.map((id) => second.byId[id].kind).filter((kind) => kind === "pdf")).toHaveLength(2);
    expect(ids.map((id) => pdfDocumentIdOf(second.byId[id])).filter((id) => id !== null).sort()).toEqual([70, 80]);
    expect(ids.map((id) => noteIn(second, id)).filter((id) => id !== undefined && id !== null).sort()).toContain(8);
  });

  it("does nothing for a window that is not there", () => {
    const { panels, newId } = start();

    expect(openPdfPair(panels, "w9", 7, 70, newId)).toBe(panels);
  });

  it("splits beside a note panel that is not the first thing in the window", () => {
    const { panels, newId } = start();
    let state = setPanelKind(panels, "p1", "notes-browser");
    state = splitPanel(state, "p1", "right", { id: "x", kind: "empty", state: null });

    const opened = openPdfPair(state, MAIN_WINDOW, 7, 70, newId);

    expect(kindsOf(opened)).toEqual(["notes-browser", "pdf", "note"]);
  });
});

describe("a PDF panel's saved state", () => {
  it("starts with no PDF, and is read back with the one it showed", () => {
    expect(KINDS.pdf.initialState()).toEqual({ documentId: null });
    expect(KINDS.pdf.restore({ documentId: 12 }, { hasNote: () => true, hasNotebook: () => true })).toEqual({ documentId: 12 });
  });

  it("keeps a PDF that may be gone, for the panel to say so, but not something that is not an id", () => {
    const context = { hasNote: () => true, hasNotebook: () => true };

    expect(KINDS.pdf.restore({ documentId: "12" }, context)).toEqual({ documentId: null });
    expect(KINDS.pdf.restore({ documentId: 1.5 }, context)).toEqual({ documentId: null });
    expect(KINDS.pdf.restore(null, context)).toBeNull();
    expect(KINDS.pdf.restore("x", context)).toBeNull();
  });

  it("names its PDF, and no other kind does", () => {
    const { panels } = start();

    expect(pdfDocumentIdOf({ id: "a", kind: "pdf", state: { documentId: 3 } })).toBe(3);
    expect(pdfDocumentIdOf({ id: "a", kind: "note", state: { noteId: 3, view: "split" } })).toBeNull();
    expect(pdfDocumentIdOf(panels.byId.p1)).toBeNull();
  });
});
