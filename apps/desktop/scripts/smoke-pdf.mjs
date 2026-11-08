// End-to-end check of the PDF reader in the real app (docs/pdf-markup-plan.md, Step 2): a PDF is imported through the native
// picker (stubbed here, the way the main process would receive a path), becomes a note with a PDF panel beside it, is read
// through the app scheme with byte ranges under the app's own security policy, remembers where the reader was across a
// restart, and goes to the Trash Can and back with its note. Like smoke.mjs it runs against a throwaway HOME and user-data
// directory (build first with `pnpm build`).
//
//   pnpm build && pnpm smoke:pdf
//   SMOKE_EXECUTABLE=release/mac-arm64/Composition.app/Contents/MacOS/Composition pnpm smoke:pdf
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";
import { makeTestPdf, pageText } from "./pdf-fixture.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The export's result is read back with the writer's own library, which the web package has.
const { PDFDocument, PDFDict, PDFName } = createRequire(path.join(desktopDir, "../web/package.json"))("@cantoo/pdf-lib");
const packaged = process.env.SMOKE_EXECUTABLE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-pdf-smoke-"));
const userData = path.join(home, "userData");
const out = process.env.SMOKE_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "composition-pdf-shots-"));
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const pdfFile = path.join(home, "Designing_Data.pdf");
fs.writeFileSync(pdfFile, makeTestPdf({ pages: 12 }));
// The same bytes under another name, to import a second time.
const copyFile = path.join(home, "Designing_Data copy.pdf");
fs.copyFileSync(pdfFile, copyFile);

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, { timeout = 20_000, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(interval);
  }
  throw last ?? new Error("timed out");
}

const launch = () =>
  electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [`--user-data-dir=${userData}`] : [desktopDir, `--user-data-dir=${userData}`],
    env: { ...process.env, HOME: home },
    cwd: "/",
  });

const consoleProblems = [];
async function open(app) {
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error" || /Refused to|Content Security Policy/i.test(message.text())) consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) consoleProblems.push(`${response.status()} ${response.url()}`);
  });
  await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 30_000 });
  return page;
}
const documents = (page) => page.evaluate(() => window.composition.listDocuments());
/** Makes the native picker answer with this file, as the user choosing it would. */
const pick = (app, file) => app.evaluate(({ dialog }, chosen) => void (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })), file);

let app = await launch();
let page;
try {
  page = await open(app);

  // ---- Import
  await pick(app, pdfFile);
  await page.getByRole("button", { name: "+ Import PDF…" }).click();
  const reader = page.getByRole("region", { name: "PDF: Designing_Data.pdf" });
  await reader.waitFor({ timeout: 20_000 });
  check("importing a PDF makes a note titled from the file, with a PDF row", (await page.getByRole("button", { name: /Designing Data/ }).count()) >= 1 && (await page.getByRole("img", { name: "PDF" }).count()) === 1);
  const panels = await page.evaluate(() => Object.values(window.__workspace.store.getSnapshot().panels.byId).map((p) => p.kind).sort());
  check("it opens a PDF panel beside the note's own panel", JSON.stringify(panels) === JSON.stringify(["note", "pdf"]), panels.join(","));

  // ---- The first page is drawn, with its text layer, read through the app scheme
  await reader.locator(".textLayer", { hasText: pageText(1) }).first().waitFor({ timeout: 20_000 });
  check("the first page is drawn and its text is selectable", (await reader.locator(".canvasWrapper canvas").count()) >= 1);
  const [doc] = await documents(page);
  const counted = await waitFor(async () => (await documents(page))[0]?.pageCount === 12).catch(() => false);
  check("the reader counts the pages and the app remembers them", Boolean(counted), String(doc?.pageCount));
  const served = await page.evaluate(async (id) => {
    const ranged = await fetch(`app://composition/documents/${id}`, { headers: { Range: "bytes=0-7" } });
    const missing = await fetch("app://composition/documents/987654");
    return { status: ranged.status, range: ranged.headers.get("content-range"), type: ranged.headers.get("content-type"), text: await ranged.text(), missing: missing.status };
  }, doc.id);
  check("the app scheme serves a byte range of the file, and a missing id is a 404", served.status === 206 && /^bytes 0-7\/\d+$/.test(served.range) && served.type === "application/pdf" && served.text === "%PDF-1.7" && served.missing === 404, JSON.stringify(served));
  // The 404 above was asked for on purpose; it is not a problem with the app.
  consoleProblems.length = 0;
  await page.screenshot({ path: path.join(out, "pdf-reader.png") });

  // ---- Pages, labels and the page box
  const pageBox = reader.getByRole("textbox", { name: "Page number" });
  await pageBox.fill("5");
  await pageBox.press("Enter");
  await waitFor(async () => (await pageBox.inputValue()) === "5");
  await waitFor(async () => (await reader.getByText("(page 2)").count()) === 1);
  check("going to page 5 shows the printed label: the 4th page is page 1, so the 5th is page 2", true);
  await reader.locator(".textLayer", { hasText: pageText(5) }).first().waitFor({ timeout: 10_000 });

  // ---- Outline
  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  const outline = reader.getByRole("tree", { name: "Outline" });
  await outline.waitFor();
  check("the outline lists the chapters and their sections", (await outline.getByRole("treeitem").count()) >= 5, String(await outline.getByRole("treeitem").count()));
  await outline.getByRole("button", { name: "Second section" }).click();
  await waitFor(async () => (await pageBox.inputValue()) === "6");
  check("an outline entry goes to its page", true);

  // ---- Bookmarks
  await reader.getByRole("button", { name: "Bookmark this page" }).click();
  const bookmarks = reader.getByRole("list", { name: "Bookmarks" });
  await bookmarks.waitFor();
  check("a bookmark is added for the page, named by its printed label", (await bookmarks.getByRole("button", { name: "Page 3", exact: true }).count()) === 1);
  await bookmarks.getByRole("button", { name: "Rename the bookmark on page 3" }).click({ force: true });
  await reader.getByRole("textbox", { name: "Bookmark name" }).fill("Methods");
  await reader.getByRole("textbox", { name: "Bookmark name" }).press("Enter");
  await bookmarks.getByRole("button", { name: /Methods/ }).waitFor();
  check("a bookmark can be renamed, and is kept", (await page.evaluate((id) => window.composition.listBookmarks(id), doc.id))[0]?.label === "Methods");
  await pageBox.fill("1");
  await pageBox.press("Enter");
  await bookmarks.getByRole("button", { name: /Methods/ }).click();
  await waitFor(async () => (await pageBox.inputValue()) === "6");
  check("clicking a bookmark goes to its page", true);

  // ---- Find
  await reader.getByRole("button", { name: "Find in this PDF" }).click();
  await reader.getByRole("textbox", { name: "Find in this PDF" }).fill("page 9");
  const counting = await waitFor(async () => /1 of 2/.test((await reader.getByRole("search").innerText()) || "")).catch(() => false);
  check("find counts the matches in the whole PDF, not just the page in view", Boolean(counting), await reader.getByRole("search").innerText());
  await reader.getByRole("button", { name: "Close find" }).click();

  // ---- Dark pages
  await reader.getByRole("button", { name: "Dark pages" }).click();
  check("dark pages inverts the page images and is remembered for the PDF", (await reader.getByRole("button", { name: "Dark pages" }).getAttribute("aria-pressed")) === "true" && (await documents(page))[0]?.viewState.darkPages === true);
  await page.screenshot({ path: path.join(out, "pdf-dark.png") });

  // ---- Where the reader was is saved
  await pageBox.fill("6");
  await pageBox.press("Enter");
  const saved = await waitFor(async () => (await documents(page))[0]?.viewState.page === 5, { timeout: 8000 }).catch(() => false);
  check("the reading position is saved a moment after the reader stops", Boolean(saved), JSON.stringify((await documents(page))[0]?.viewState));

  // ---- Marks: select text and mark it
  // The sidebar is still open from the bookmarks, and in a panel this narrow it covers the pages, so it is put away.
  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  await reader.getByRole("complementary", { name: "PDF sidebar" }).waitFor({ state: "detached" });
  const marksOf = () => page.evaluate((id) => window.composition.listAnnotations(id), doc.id);
  /** Selects from the start of `from` to the end of `to`, which are texts of the pages' text layers. */
  const select = (from, to) =>
    page.evaluate(
      ([a, b]) => {
        const spans = [...document.querySelectorAll(".pdfViewer .textLayer span")];
        const first = spans.find((s) => s.textContent?.includes(a));
        const last = spans.find((s) => s.textContent?.includes(b));
        const selection = window.getSelection();
        selection.removeAllRanges();
        const range = document.createRange();
        range.setStart(first.firstChild, first.textContent.indexOf(a));
        range.setEnd(last.firstChild, last.textContent.indexOf(b) + b.length);
        selection.addRange(range);
      },
      [from, to],
    );
  /** A mark takes no mouse of its own (the words under it stay selectable), so it is clicked where it is, on the page. */
  const clickMark = async (mark) => {
    const at = await mark.boundingBox();
    await page.mouse.click(at.x + 12, at.y + at.height / 2);
  };
  const openMark = async (mark) => {
    await clickMark(mark);
    await reader.getByRole("dialog", { name: "Mark" }).waitFor();
  };
  await pageBox.fill("6");
  await pageBox.press("Enter");
  await reader.locator(".textLayer", { hasText: pageText(6) }).first().waitFor();
  await select(pageText(6), pageText(6));
  const toolbar = page.getByRole("toolbar", { name: "Mark the selected text" });
  await toolbar.waitFor();
  await toolbar.getByRole("button", { name: "Highlight" }).click();
  const first = await waitFor(async () => (await marksOf())[0]).catch(() => null);
  check("a highlight is made from the selected text, with the words as its quote", first?.kind === "highlight" && first?.page === 5 && first?.quote === pageText(6) && first?.color === "yellow", JSON.stringify(first));
  const rect = first?.rects?.[0] ?? [0, 0, 0, 0];
  // The line is 24 pt Helvetica with its baseline at (72, 700) in the file: its box starts at 72 pt, is as wide as the words and holds the baseline.
  check("its rectangle is in the PDF's own coordinates, around the line it marks", Math.abs(rect[0] - 72) < 3 && rect[2] - rect[0] > 150 && rect[2] - rect[0] < 330 && rect[1] <= 700 && rect[3] >= 700 && rect[3] - rect[1] < 40, JSON.stringify(rect));
  const putAway = await waitFor(async () => (await toolbar.count()) === 0).catch(() => false);
  check("and the selection toolbar is put away", Boolean(putAway));
  await waitFor(async () => (await reader.locator('[data-mark-kind="highlight"]').count()) === 1);
  const box = await reader.locator('[data-mark-kind="highlight"]').first().boundingBox();
  const textBox = await reader.locator(".textLayer span", { hasText: pageText(6) }).first().boundingBox();
  check("the highlight is drawn over the words, where the selection was", Math.abs(box.x - textBox.x) < 4 && Math.abs(box.y - textBox.y) < 8 && box.width > 100, `${JSON.stringify(box)} vs ${JSON.stringify(textBox)}`);
  await page.screenshot({ path: path.join(out, "pdf-marks.png") });

  await select("Some words to select and search on page 6.", "page 6.");
  // A mouse selection leaves the focus in the pages; a scripted one leaves it where it was, so it is put there.
  await reader.locator('[role="document"]').focus();
  await page.keyboard.press("ControlOrMeta+Shift+U");
  const underlined = await waitFor(async () => (await marksOf()).find((m) => m.kind === "underline")).catch(() => null);
  check("Ctrl/Cmd+Shift+U underlines the selection", underlined?.page === 5 && /page 6\.$/.test(underlined?.quote ?? ""), JSON.stringify(underlined));
  // The mark is in the database a moment before the reader hears of it and puts the selection toolbar away, and the toolbar sits
  // over the line above the selection, where the next click is aimed; so the click waits for the toolbar to go.
  await toolbar.waitFor({ state: "detached" });

  // ---- Select a mark: recolor, comment, jump to it from the list
  await openMark(reader.locator('[data-mark-kind="highlight"]').first());
  const popover = reader.getByRole("dialog", { name: "Mark" });
  await popover.waitFor();
  await popover.getByRole("button", { name: "Green" }).click();
  await waitFor(async () => (await marksOf()).find((m) => m.id === first.id)?.color === "green");
  check("clicking a mark offers its colors, and a color is kept", true);
  const comment = popover.getByRole("textbox", { name: "Comment" });
  await comment.fill("check the title");
  await comment.press("Enter");
  await waitFor(async () => (await marksOf()).find((m) => m.id === first.id)?.comment === "check the title");
  check("and a one-line comment is kept", true);

  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  await reader.getByRole("tab", { name: "highlights" }).click();
  const highlights = reader.getByRole("list", { name: "Highlights" });
  await highlights.waitFor();
  check("the Highlights tab lists the marks by page with their words and comments", /Page 3/.test(await highlights.innerText()) && (await highlights.innerText()).includes(pageText(6)) && (await highlights.innerText()).includes("check the title"), await highlights.innerText());
  await pageBox.fill("1");
  await pageBox.press("Enter");
  await waitFor(async () => (await pageBox.inputValue()) === "1");
  await highlights.getByRole("button", { name: pageText(6) }).click();
  await waitFor(async () => (await pageBox.inputValue()) === "6");
  check("clicking a highlight in the list goes to it", true);

  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  await reader.getByRole("complementary", { name: "PDF sidebar" }).waitFor({ state: "detached" });

  // ---- Undo and redo
  await page.getByRole("button", { name: "Undo" }).first().click();
  await waitFor(async () => (await marksOf()).find((m) => m.id === first.id)?.comment === "");
  check("Undo takes back the comment", true);
  await reader.getByRole("button", { name: "Redo" }).click();
  await waitFor(async () => (await marksOf()).find((m) => m.id === first.id)?.comment === "check the title");
  check("Redo puts it back", true);
  await reader.getByRole("textbox", { name: "Page number" }).blur();
  await reader.locator('[role="document"]').focus();
  await page.keyboard.press("ControlOrMeta+Z");
  await waitFor(async () => (await marksOf()).find((m) => m.id === first.id)?.comment === "");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await waitFor(async () => (await marksOf()).find((m) => m.id === first.id)?.comment === "check the title");
  check("Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z do the same from the keyboard", true);

  // ---- Delete a mark, and undo it: it comes back as it was, with the same uuid
  const before = (await marksOf()).find((m) => m.id === first.id);
  await openMark(reader.locator('[data-mark-kind="highlight"]').first());
  await reader.getByRole("dialog", { name: "Mark" }).getByRole("button", { name: "Delete this mark" }).click();
  await waitFor(async () => !(await marksOf()).some((m) => m.id === first.id));
  check("a mark can be deleted from its popover", (await reader.locator('[data-mark-kind="highlight"]').count()) === 0);
  await reader.getByRole("button", { name: "Undo" }).click();
  const back = await waitFor(async () => (await marksOf()).find((m) => m.uuid === before.uuid)).catch(() => null);
  check("undoing the delete brings it back exactly, with its uuid and comment", back?.uuid === before.uuid && back?.comment === "check the title" && JSON.stringify(back?.rects) === JSON.stringify(before.rects));
  await waitFor(async () => (await reader.locator('[data-mark-kind="highlight"]').count()) === 1);

  // ---- A selection across two pages is one mark per page, tied together
  await pageBox.fill("7");
  await pageBox.press("Enter");
  await reader.locator(".textLayer", { hasText: pageText(7) }).first().waitFor();
  await reader.locator('[role="document"]').evaluate((el) => void (el.scrollTop += 380));
  await reader.locator(".textLayer", { hasText: pageText(8) }).first().waitFor({ timeout: 10_000 });
  // pdf.js may still be settling the pages it has just scrolled into view, and builds a page's text again when it does,
  // which drops a selection; so the selection is made again until it holds, as a person would.
  await waitFor(async () => {
    await select("Some words to select and search on page 7.", pageText(8));
    await sleep(400);
    return (await toolbar.count()) === 1;
  }, { timeout: 20_000, interval: 300 });
  await toolbar.getByRole("button", { name: "Color: Blue" }).click();
  await toolbar.getByRole("button", { name: "Highlight" }).click();
  const crossed = await waitFor(async () => (await marksOf()).filter((m) => m.color === "blue")).then((m) => (m.length === 2 ? m : null)).catch(() => null);
  check("a selection over two pages makes a mark on each, tied by one group", crossed?.length === 2 && crossed[0].groupUuid !== null && crossed[0].groupUuid === crossed[1].groupUuid && [crossed[0].page, crossed[1].page].sort().join() === "6,7", JSON.stringify(crossed?.map((m) => [m.page, m.quote, m.groupUuid])));
  await reader.getByRole("button", { name: "Undo" }).click();
  await waitFor(async () => (await marksOf()).filter((m) => m.color === "blue").length === 0);
  check("and one Undo takes back both", true);
  await reader.getByRole("button", { name: "Redo" }).click();
  await waitFor(async () => (await marksOf()).filter((m) => m.color === "blue").length === 2);

  // ---- A typed text note
  await pageBox.fill("6");
  await pageBox.press("Enter");
  await reader.locator(".textLayer", { hasText: pageText(6) }).first().waitFor();
  await reader.getByRole("button", { name: "Add a text note" }).click();
  await reader.getByRole("button", { name: "Place a text note on page 6" }).click({ position: { x: 150, y: 260 } });
  const draft = reader.getByRole("textbox", { name: "Text note" });
  await draft.waitFor();
  await draft.fill("Check this against chapter two");
  await draft.press("ControlOrMeta+Enter");
  const typed = await waitFor(async () => (await marksOf()).find((m) => m.kind === "text")).catch(() => null);
  check("a text note is placed where the page is clicked, and kept with its words", typed?.body?.text === "Check this against chapter two" && typed?.page === 5 && typed?.body?.rect?.length === 4, JSON.stringify(typed));
  check("and no empty note is ever made", (await marksOf()).every((m) => m.kind !== "text" || m.body.text.trim() !== ""));
  await reader.getByRole("note").first().dblclick();
  const edit = reader.getByRole("textbox", { name: "Text note" });
  await edit.fill("Checked");
  await edit.press("ControlOrMeta+Enter");
  await waitFor(async () => (await marksOf()).find((m) => m.kind === "text")?.body.text === "Checked");
  check("a text note is retyped by a double click", true);
  await page.screenshot({ path: path.join(out, "pdf-marks-all.png") });

  // ---- Notes cite the PDF: Quote, Cite this page, following a link
  const noteEditor = page.locator('textarea[aria-label="Markdown editor"]');
  const editorText = () => noteEditor.inputValue();
  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  await reader.getByRole("tab", { name: "highlights" }).click();
  await reader.getByRole("list", { name: "Highlights" }).waitFor();
  const firstHighlight = (await marksOf()).find((m) => m.kind === "highlight" && m.page === 5);
  await reader.getByRole("button", { name: /^Quote the highlight on page/ }).first().click();
  const quoted = await waitFor(async () => (await editorText()).includes("pdf:")).catch(() => false);
  const quoteLine = `> ${pageText(6)}\n>\n> — [*Designing Data*, p. 3](pdf:${doc.uuid}#p=6&a=${firstHighlight.uuid})`;
  check("Quote puts the highlight's words into the note beside the PDF, as a block quote that cites the page and the mark", Boolean(quoted) && (await editorText()).includes(quoteLine), await editorText());
  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  await reader.getByRole("complementary", { name: "PDF sidebar" }).waitFor({ state: "detached" });
  await pageBox.fill("9");
  await pageBox.press("Enter");
  await waitFor(async () => (await pageBox.inputValue()) === "9");
  await reader.getByRole("button", { name: "Cite this page" }).click();
  const cited = await waitFor(async () => (await editorText()).includes(`(pdf:${doc.uuid}#p=9)`)).catch(() => false);
  check("Cite this page puts a link to the page the reader is on into the note, by its printed label", Boolean(cited) && /\[\*Designing Data\*, p\. 6\]\(pdf:/.test(await editorText()), await editorText());
  await page.screenshot({ path: path.join(out, "pdf-quote.png") });

  // The preview draws both as links, and following one shows the page and flashes the mark.
  await page.getByRole("tab", { name: "Preview" }).click();
  const previewLink = page.getByRole("link", { name: "Designing Data, p. 3" });
  await previewLink.waitFor();
  check("the preview draws a citation as a link", (await page.getByRole("link", { name: "Designing Data, p. 6" }).count()) === 1);
  await pageBox.fill("1");
  await pageBox.press("Enter");
  await waitFor(async () => (await pageBox.inputValue()) === "1");
  await previewLink.click();
  await waitFor(async () => (await pageBox.inputValue()) === "6", { timeout: 15_000 });
  check("following a citation goes to its page", true);
  const flashed = await reader.locator("[data-flash]").first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check("and flashes the mark it names", flashed);
  await page.screenshot({ path: path.join(out, "pdf-followed.png") });
  const goToDropped = await waitFor(async () =>
    (await page.evaluate(() => Object.values(window.__workspace.store.getSnapshot().panels.byId).filter((p) => p.kind === "pdf").every((p) => p.state.goTo === undefined))),
  ).catch(() => false);
  check("the flash ends and the ask is dropped, so a restored layout does not repeat it", Boolean(goToDropped) && (await reader.locator("[data-flash]").count()) === 0);
  await page.getByRole("link", { name: "Designing Data, p. 6" }).click();
  await waitFor(async () => (await pageBox.inputValue()) === "9", { timeout: 15_000 });
  check("a citation of a page alone goes there too", true);
  check("and no second PDF panel was opened for the link", (await page.evaluate(() => Object.values(window.__workspace.store.getSnapshot().panels.byId).filter((p) => p.kind === "pdf").length)) === 1);
  await page.getByRole("tab", { name: "Markdown" }).click();

  // The Notes tab lists the notes that cite the PDF, and makes a new one.
  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  await reader.getByRole("tab", { name: "notes" }).click();
  const notesList = reader.getByRole("list", { name: "Notes" });
  await notesList.waitFor();
  check("the Notes tab lists the PDF's own note, with the pages it cites", /Designing Data\s*This PDF's own note · 2 pages/.test((await notesList.innerText()).replace(/\n/g, "")), await notesList.innerText());
  await reader.getByRole("button", { name: "New note for this PDF" }).click();
  const made = await waitFor(async () => page.evaluate(() => window.__workspace.store.getSnapshot().notes.find((n) => n.title === "Notes on Designing Data") ?? null)).catch(() => null);
  check("New note for this PDF makes a note whose first line links to the PDF", Boolean(made) && made.content.includes(`[Designing Data](pdf:${doc.uuid})`), JSON.stringify(made));
  const pinned = await waitFor(async () => (await page.evaluate(() => Object.values(window.__workspace.store.getSnapshot().panels.byId).find((p) => p.kind === "pdf").state.noteId)) === made?.id).catch(() => false);
  check("and shows it beside the PDF, which is now paired with it", Boolean(pinned) && (await editorText()).includes(`pdf:${doc.uuid}`));
  await reader.getByRole("tab", { name: "notes" }).click();
  check("the new note is listed, and it is the paired one", (await notesList.getByRole("button", { name: /Notes on Designing Data/ }).getAttribute("aria-current")) === "true");
  await reader.getByRole("button", { name: "Outline and bookmarks" }).click();
  await reader.getByRole("complementary", { name: "PDF sidebar" }).waitFor({ state: "detached" });
  check("the app has no CSP violations or errors after all that", consoleProblems.length === 0, consoleProblems.join(" | "));
  // Back to the page the marks are on, which is where the restart below is expected to find the reader.
  await pageBox.fill("6");
  await pageBox.press("Enter");
  await waitFor(async () => (await documents(page))[0]?.viewState.page === 5, { timeout: 8000 });

  // ---- Export a copy with the marks in it, native and then flattened
  /** The annotation kinds on each page of a written PDF, counted, and how many pages it has. */
  async function readBack(file) {
    const written = await PDFDocument.load(fs.readFileSync(file));
    const kinds = {};
    for (const written_page of written.getPages()) {
      for (const entry of written_page.node.Annots()?.asArray() ?? []) {
        const kind = written.context.lookup(entry, PDFDict).lookup(PDFName.of("Subtype")).toString();
        kinds[kind] = (kinds[kind] ?? 0) + 1;
      }
    }
    return { kinds, pages: written.getPageCount() };
  }
  const exportTo = async (file, { flatten }) => {
    await app.evaluate(({ dialog }, chosen) => void (dialog.showSaveDialog = async () => ({ canceled: false, filePath: chosen })), file);
    await reader.getByRole("button", { name: "Export annotated PDF" }).click();
    const exportDialog = page.getByRole("dialog", { name: "Export annotated PDF" });
    if (flatten) await exportDialog.getByRole("checkbox", { name: "Flatten markup" }).click();
    await exportDialog.getByRole("button", { name: "Export…" }).click();
    return reader.getByRole("status").filter({ hasText: /^Saved/ }).innerText({ timeout: 60_000 });
  };
  const nativeCopy = path.join(home, "exported.pdf");
  const nativeSaid = await exportTo(nativeCopy, { flatten: false });
  const native = await readBack(nativeCopy);
  check("Export asks where to save, writes the copy out of the main process and says how many marks it holds", /^Saved “exported\.pdf” with \d+ marks?\./.test(nativeSaid), nativeSaid);
  check("the copy's marks are native annotations: the highlights, the underline and the text note", native.kinds["/Highlight"] === 3 && native.kinds["/Underline"] === 1 && native.kinds["/FreeText"] === 1 && native.pages === 12, JSON.stringify(native));
  const flatCopy = path.join(home, "exported-flat.pdf");
  await reader.getByRole("button", { name: "Dismiss" }).click();
  await exportTo(flatCopy, { flatten: true });
  const flat = await readBack(flatCopy);
  check("flattened, the marks are drawn into the pages and no annotation is left", Object.keys(flat.kinds).length === 0 && flat.pages === 12 && fs.statSync(flatCopy).size > fs.statSync(pdfFile).size, JSON.stringify(flat));
  const libraryFile = path.join(home, ".composition", "documents", fs.readdirSync(path.join(home, ".composition", "documents"))[0]);
  check("the PDF in the library is exactly as it was imported", Buffer.compare(fs.readFileSync(libraryFile), fs.readFileSync(pdfFile)) === 0);
  check("no partial file is left beside the copies", fs.readdirSync(home).every((name) => !name.endsWith(".part")));
  await page.screenshot({ path: path.join(out, "pdf-exported.png") });
  await reader.getByRole("button", { name: "Dismiss" }).click();

  // ---- A second import of the same file asks first
  await pick(app, copyFile);
  await page.getByRole("button", { name: "+ Import PDF…" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  check("importing the same file again asks, naming the note that has it", /You already have this PDF/.test(await dialog.innerText()) && /“Designing_Data copy.pdf” has exactly the same contents as “Designing Data”/.test(await dialog.innerText()), await dialog.innerText());
  check("and nothing was imported yet", (await documents(page)).length === 1);
  await dialog.getByRole("button", { name: "Import a separate copy" }).click();
  await waitFor(async () => (await documents(page)).length === 2);
  const noted = await waitFor(async () => (await page.evaluate(() => window.__workspace.store.getSnapshot().notes.length)) === 3).catch(() => false);
  check("a separate copy can be imported on request, as another note (beside the original and the note made for it)", Boolean(noted), String(await page.evaluate(() => window.__workspace.store.getSnapshot().notes.map((n) => n.title))));
  check("the app has no CSP violations or errors so far", consoleProblems.length === 0, consoleProblems.join(" | "));

  // ---- Delete the first PDF's note: the dialog says what is inside
  const firstNote = (await documents(page))[0].noteId;
  const title = await page.evaluate((id) => window.__workspace.store.getSnapshot().notes.find((n) => n.id === id).title, firstNote);
  await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click({ force: true });
  const confirm = page.getByRole("alertdialog");
  await confirm.waitFor();
  const said = await waitFor(async () => /its PDF \(\d[\d.]* [KM]?B\), \d+ highlights?.* and 1 bookmark/.test(await confirm.innerText()) && (await confirm.innerText())).catch(() => false);
  check("the delete dialog names what is inside: the PDF, its marks and its bookmark", Boolean(said), await confirm.innerText());
  check("and says how many notes cite it, whose quotes stay", /1 note cites it; its quote stays and its links stop working\./.test(await confirm.innerText()), await confirm.innerText());
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await waitFor(async () => !(await page.evaluate((id) => window.__workspace.store.getSnapshot().notes.some((n) => n.id === id), firstNote)));
  const trash = await page.evaluate(() => window.composition.loadTrash());
  check("the Trash Can lists the note with its PDF's contents", trash.notes.length === 1 && trash.notes[0].pdf?.bookmarks === 1 && trash.notes[0].pdf?.fileName === "Designing_Data.pdf", JSON.stringify(trash.notes));
  const stored = () => fs.readdirSync(path.join(home, ".composition", "documents"));
  check("the PDF's file stays while its note is in the Trash Can", stored().length === 2);

  // ---- Restart: the panel and the reading position come back
  await app.close();
  app = await launch();
  page = await open(app);
  await page.evaluate((id) => window.composition.restoreNote(id), firstNote);
  await page.reload();
  await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 30_000 });
  // The row's name starts with its PDF icon ("PDF Designing Data"), and the other PDF's title continues with " copy".
  await page.getByRole("button", { name: /Designing Data(?! copy)/ }).first().click();
  const again = page.getByRole("region", { name: "PDF: Designing_Data.pdf" }).first();
  await again.waitFor({ timeout: 20_000 });
  await again.locator(".textLayer", { hasText: pageText(6) }).first().waitFor({ timeout: 20_000 });
  check("a restored note opens with its PDF, back on the page it was left on", (await again.getByRole("textbox", { name: "Page number" }).inputValue()) === "6");
  await waitFor(async () => (await again.locator("[data-mark-kind]").count()) >= 3, { timeout: 15_000 }).catch(() => {});
  check("its marks are drawn again after the restart", (await again.locator('[data-mark-kind="highlight"]').count()) >= 1 && (await again.locator('[data-mark-kind="underline"]').count()) === 1 && (await again.getByRole("note").count()) === 1);
  check("with dark pages still on", (await again.getByRole("button", { name: "Dark pages" }).getAttribute("aria-pressed")) === "true");
  await page.screenshot({ path: path.join(out, "pdf-restored.png") });
  check("no CSP violations or errors after the restart either", consoleProblems.length === 0, consoleProblems.join(" | "));
} catch (error) {
  // A step that cannot go on: say what the page showed, which is usually the whole story.
  console.error(error);
  failures.push(`stopped early: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  if (page) {
    await page.screenshot({ path: path.join(out, "pdf-failure.png") }).catch(() => {});
    console.log("console problems:", consoleProblems.slice(0, 8));
    console.log(
      "where things were:",
      JSON.stringify(
        await page
          .evaluate(() => ({
            window: [innerWidth, innerHeight],
            toolbar: document.querySelector('[aria-label="Mark the selected text"]')?.getBoundingClientRect().toJSON(),
            selection: window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0).getBoundingClientRect().toJSON() : null,
          }))
          .catch(() => null),
      ),
    );
    console.log("reader text:", (await page.locator('section[aria-label^="PDF"]').first().innerText().catch(() => "")).slice(0, 400));
  }
} finally {
  await app.close().catch(() => {});
}

console.log(`\nscreenshots in ${out}`);
console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`);
fs.rmSync(home, { recursive: true, force: true });
process.exit(failures.length === 0 ? 0 : 1);
