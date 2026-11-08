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
import electronPath from "electron";
import { _electron as electron } from "playwright-core";
import { makeTestPdf, pageText } from "./pdf-fixture.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

  // ---- A second import of the same file asks first
  await pick(app, copyFile);
  await page.getByRole("button", { name: "+ Import PDF…" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor();
  check("importing the same file again asks, naming the note that has it", /You already have this PDF/.test(await dialog.innerText()) && /“Designing_Data copy.pdf” has exactly the same contents as “Designing Data”/.test(await dialog.innerText()), await dialog.innerText());
  check("and nothing was imported yet", (await documents(page)).length === 1);
  await dialog.getByRole("button", { name: "Import a separate copy" }).click();
  await waitFor(async () => (await documents(page)).length === 2);
  const noted = await waitFor(async () => (await page.evaluate(() => window.__workspace.store.getSnapshot().notes.length)) === 2).catch(() => false);
  check("a separate copy can be imported on request, as another note", Boolean(noted), String(await page.evaluate(() => window.__workspace.store.getSnapshot().notes.map((n) => n.title))));
  check("the app has no CSP violations or errors so far", consoleProblems.length === 0, consoleProblems.join(" | "));

  // ---- Delete the first PDF's note: the dialog says what is inside
  const firstNote = (await documents(page))[0].noteId;
  const title = await page.evaluate((id) => window.__workspace.store.getSnapshot().notes.find((n) => n.id === id).title, firstNote);
  await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click({ force: true });
  const confirm = page.getByRole("alertdialog");
  await confirm.waitFor();
  const said = await waitFor(async () => /its PDF \(\d[\d.]* [KM]?B\) and 1 bookmark/.test(await confirm.innerText()) && (await confirm.innerText())).catch(() => false);
  check("the delete dialog names what is inside: the PDF and its bookmark", Boolean(said), await confirm.innerText());
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
    console.log("reader text:", (await page.locator('section[aria-label^="PDF"]').first().innerText().catch(() => "")).slice(0, 400));
  }
} finally {
  await app.close().catch(() => {});
}

console.log(`\nscreenshots in ${out}`);
console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}`);
fs.rmSync(home, { recursive: true, force: true });
process.exit(failures.length === 0 ? 0 : 1);
