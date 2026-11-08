import { describe, expect, it } from "vitest";
import { KINDS, pdfDocumentIdOf, type NotePanelState, type PdfPanelState } from "./kinds";
import { panelIds } from "./layoutTree";
import {
  MAIN_WINDOW,
  clearPdfGoTo,
  focusPanel,
  focusedPanelId,
  initialPanels,
  openLinkedPdf,
  openNote,
  openNoteForPdf,
  openPdfPair,
  pdfSubject,
  setPanelKind,
  setPdfFollow,
  splitPanel,
  type PanelsState,
} from "./panelsState";

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
    expect(opened.byId[ids[0]].state).toEqual({ documentId: 70, noteId: 7, follow: false } satisfies PdfPanelState);
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
  const context = { hasNote: (id: number) => id !== 99, hasNotebook: () => true };

  it("starts with no PDF, following the note in use, and is read back with the one it showed and the note it was pinned to", () => {
    expect(KINDS.pdf.initialState()).toEqual({ documentId: null, noteId: null, follow: true });
    expect(KINDS.pdf.restore({ documentId: 12, noteId: 7, follow: false }, context)).toEqual({ documentId: 12, noteId: 7, follow: false });
    expect(KINDS.pdf.restore({ documentId: 12, noteId: null, follow: true }, context)).toEqual({ documentId: 12, noteId: null, follow: true });
  });

  it("follows the note in use when it was saved before PDFs had a pairing, or was pinned to a note that is gone", () => {
    expect(KINDS.pdf.restore({ documentId: 12 }, context)).toEqual({ documentId: 12, noteId: null, follow: true });
    expect(KINDS.pdf.restore({ documentId: 12, noteId: 99, follow: false }, context)).toEqual({ documentId: 12, noteId: null, follow: true });
  });

  it("does not save a request to go to a page, which has been answered or never will be", () => {
    expect(KINDS.pdf.restore({ documentId: 12, noteId: 7, follow: false, goTo: { page: 3, mark: null, seq: 1 } }, context)).toEqual({ documentId: 12, noteId: 7, follow: false });
  });

  it("keeps a PDF that may be gone, for the panel to say so, but not something that is not an id", () => {
    expect(KINDS.pdf.restore({ documentId: "12" }, context)).toEqual({ documentId: null, noteId: null, follow: true });
    expect(KINDS.pdf.restore({ documentId: 1.5 }, context)).toEqual({ documentId: null, noteId: null, follow: true });
    expect(KINDS.pdf.restore(null, context)).toBeNull();
    expect(KINDS.pdf.restore("x", context)).toBeNull();
  });

  it("names its PDF, and no other kind does", () => {
    const { panels } = start();

    expect(pdfDocumentIdOf({ id: "a", kind: "pdf", state: { documentId: 3, noteId: null, follow: true } })).toBe(3);
    expect(pdfDocumentIdOf({ id: "a", kind: "note", state: { noteId: 3, view: "split" } })).toBeNull();
    expect(pdfDocumentIdOf(panels.byId.p1)).toBeNull();
  });
});

const pdfPanels = (panels: PanelsState, windowId = MAIN_WINDOW) => panelIds(panels.windows[windowId].layout).filter((id) => panels.byId[id].kind === "pdf");
const stateOf = (panels: PanelsState, id: string) => panels.byId[id].state as PdfPanelState;

describe("following a pdf: link", () => {
  const goTo = { page: 44, mark: "m".repeat(32), seq: 1 };

  it("opens the PDF to the left of the note the link is in, paired with it, and leaves the note where it is", () => {
    const { panels, newId } = start();
    const withNote = openNote(panels, MAIN_WINDOW, 7, newId);
    const notePanel = panelIds(withNote.windows[MAIN_WINDOW].layout)[0];

    const followed = openLinkedPdf(withNote, notePanel, 70, goTo, newId);

    expect(kindsOf(followed)).toEqual(["pdf", "note"]);
    const [pdf] = pdfPanels(followed);
    expect(stateOf(followed, pdf)).toEqual({ documentId: 70, noteId: 7, follow: false, goTo });
    expect(noteIn(followed, notePanel)).toBe(7);
  });

  it("asks the PDF panel the window already shows to go there, and focuses it, rather than opening a second", () => {
    const { panels, newId } = start();
    const pair = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);
    const [pdf, notePanel] = panelIds(pair.windows[MAIN_WINDOW].layout);
    const elsewhere = focusPanel(pair, notePanel);

    const followed = openLinkedPdf(elsewhere, notePanel, 70, goTo, newId);

    expect(pdfPanels(followed)).toEqual([pdf]);
    expect(stateOf(followed, pdf)).toEqual({ documentId: 70, noteId: 7, follow: false, goTo });
    expect(focused(followed).id).toBe(pdf);
  });

  it("opens the PDF beside a note panel of another PDF's pair, since each PDF has its own panel", () => {
    const { panels, newId } = start();
    const pair = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);
    const notePanel = panelIds(pair.windows[MAIN_WINDOW].layout)[1];

    const followed = openLinkedPdf(pair, notePanel, 80, goTo, newId);

    expect(pdfPanels(followed).map((id) => stateOf(followed, id).documentId).sort()).toEqual([70, 80]);
  });

  it("does nothing for a panel that is not there", () => {
    const { panels, newId } = start();

    expect(openLinkedPdf(panels, "nope", 70, goTo, newId)).toBe(panels);
  });

  it("drops the request once the reader has answered it, and does nothing when there is none", () => {
    const { panels, newId } = start();
    const withNote = openNote(panels, MAIN_WINDOW, 7, newId);
    const followed = openLinkedPdf(withNote, panelIds(withNote.windows[MAIN_WINDOW].layout)[0], 70, goTo, newId);
    const [pdf] = pdfPanels(followed);

    const cleared = clearPdfGoTo(followed, pdf);

    expect(stateOf(cleared, pdf)).toEqual({ documentId: 70, noteId: 7, follow: false });
    expect(clearPdfGoTo(cleared, pdf)).toBe(cleared);
    expect(clearPdfGoTo(cleared, "nope")).toBe(cleared);
  });

  it("drops only the request it was told about, so that a newer one is not lost", () => {
    const { panels, newId } = start();
    const withNote = openNote(panels, MAIN_WINDOW, 7, newId);
    const notePanel = panelIds(withNote.windows[MAIN_WINDOW].layout)[0];
    const first = openLinkedPdf(withNote, notePanel, 70, goTo, newId);
    const [pdf] = pdfPanels(first);
    const second = openLinkedPdf(first, notePanel, 70, { ...goTo, page: 5, seq: 2 }, newId);

    expect(clearPdfGoTo(second, pdf, 1)).toBe(second);
    expect(stateOf(clearPdfGoTo(second, pdf, 2), pdf).goTo).toBeUndefined();
  });

  it("focuses the PDF without asking it to go anywhere for a link to the whole PDF", () => {
    const { panels, newId } = start();
    const withNote = openNote(panels, MAIN_WINDOW, 7, newId);
    const notePanel = panelIds(withNote.windows[MAIN_WINDOW].layout)[0];

    const opened = openLinkedPdf(withNote, notePanel, 70, null, newId);
    const [pdf] = pdfPanels(opened);

    expect(stateOf(opened, pdf)).toEqual({ documentId: 70, noteId: 7, follow: false });
    const again = openLinkedPdf(focusPanel(opened, notePanel), notePanel, 70, null, newId);
    expect(focused(again).id).toBe(pdf);
    expect(stateOf(again, pdf)).toEqual({ documentId: 70, noteId: 7, follow: false });
  });
});

describe("the note a PDF panel is paired with", () => {
  it("is the note it is pinned to, or, when it follows, the note panel used last", () => {
    const { panels, newId } = start();
    const pair = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);
    const [pdf] = pdfPanels(pair);
    expect(pdfSubject(pair, pdf)).toBe(7);

    const following = setPdfFollow(pair, pdf, true);
    expect(stateOf(following, pdf)).toEqual({ documentId: 70, noteId: null, follow: true });
    expect(pdfSubject(following, pdf)).toBe(7);

    const other = openNote(following, MAIN_WINDOW, 8, newId);
    expect(pdfSubject(other, pdf)).toBe(8);
  });

  it("is pinned to the note it is paired with when following is turned off, and stays following with none to pin to", () => {
    const { panels, newId } = start();
    const pair = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);
    const [pdf] = pdfPanels(pair);
    const following = setPdfFollow(pair, pdf, true);
    const moved = openNote(following, MAIN_WINDOW, 8, newId);

    const pinned = setPdfFollow(moved, pdf, false);

    expect(stateOf(pinned, pdf)).toEqual({ documentId: 70, noteId: 8, follow: false });
    expect(setPdfFollow(pinned, pdf, false)).toBe(pinned);
    const lone = setPanelKind(start().panels, "p1", "pdf");
    expect(pdfSubject(lone, "p1")).toBeNull();
    expect(setPdfFollow(lone, "p1", false)).toBe(lone);
  });

  it("is nothing for a panel that is not a PDF panel", () => {
    const { panels } = start();

    expect(pdfSubject(panels, "p1")).toBeNull();
    expect(setPdfFollow(panels, "p1", true)).toBe(panels);
  });
});

describe("picking a note in the reader's Notes tab", () => {
  it("shows it in the paired note panel and pins the PDF to it", () => {
    const { panels, newId } = start();
    const pair = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);
    const [pdf, notePanel] = panelIds(pair.windows[MAIN_WINDOW].layout);

    const opened = openNoteForPdf(pair, pdf, 9, newId);

    expect(kindsOf(opened)).toEqual(["pdf", "note"]);
    expect(noteIn(opened, notePanel)).toBe(9);
    expect(stateOf(opened, pdf)).toMatchObject({ noteId: 9, follow: false });
  });

  it("focuses the panel that already shows the note", () => {
    const { panels, newId } = start();
    const pair = openPdfPair(panels, MAIN_WINDOW, 7, 70, newId);
    const [pdf] = panelIds(pair.windows[MAIN_WINDOW].layout);
    const withTwo = openNoteBesideNoteTest(pair, newId);

    const opened = openNoteForPdf(withTwo, pdf, 9, newId);

    expect(kindsOf(opened).filter((kind) => kind === "note")).toHaveLength(2);
    expect(noteIn(opened, focused(opened).id)).toBe(9);
    expect(stateOf(opened, pdf)).toMatchObject({ noteId: 9, follow: false });
  });

  it("opens the note to the right of the PDF when no panel shows the paired note", () => {
    const { panels, newId } = start();
    const lone = setPanelKind(panels, "p1", "pdf");

    const opened = openNoteForPdf(lone, "p1", 9, newId);

    expect(kindsOf(opened)).toEqual(["pdf", "note"]);
    expect(stateOf(opened, "p1")).toMatchObject({ noteId: 9, follow: false });
  });

  it("does nothing for a panel that is not a PDF panel", () => {
    const { panels, newId } = start();

    expect(openNoteForPdf(panels, "p1", 9, newId)).toBe(panels);
  });
});

/** A second note panel, showing note 9, beside the pair's note panel. */
function openNoteBesideNoteTest(panels: PanelsState, newId: () => string): PanelsState {
  const notePanel = panelIds(panels.windows[MAIN_WINDOW].layout)[1];
  return splitPanel(panels, notePanel, "right", { id: newId(), kind: "note", state: { noteId: 9, view: "markdown" } satisfies NotePanelState });
}
