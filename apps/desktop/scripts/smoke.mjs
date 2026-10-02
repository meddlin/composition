// End-to-end smoke test: launches the real app (built with `pnpm build`, or the
// packaged app via SMOKE_EXECUTABLE) and drives it with Playwright's Electron
// support. It runs against a throwaway HOME and user-data directory, so it
// never touches real notes.
//
//   pnpm build && pnpm smoke
//   SMOKE_EXECUTABLE=release/mac-arm64/Composition.app/Contents/MacOS/Composition pnpm smoke
//   SMOKE_OUT=/some/dir  keeps screenshots there (default: a temp dir)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { transform } from "esbuild";
import { _electron as electron } from "playwright-core";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = process.env.SMOKE_EXECUTABLE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-smoke-"));
const userData = path.join(home, "userData");
const out = process.env.SMOKE_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "composition-smoke-shots-"));
fs.mkdirSync(out, { recursive: true });

// The bridge's expected members come from the same API_METHODS and ATTACHMENT_METHODS the
// preload builds `window.composition` from (plus the two non-IPC members it adds), so
// the "only the API" check below tracks the interface instead of a hand-kept
// count. api.ts is TypeScript with type-only imports, so esbuild strips it down
// to plain JS that Node can import.
async function importTypeScript(file) {
  const { code } = await transform(fs.readFileSync(file, "utf-8"), { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
const { API_METHODS } = await importTypeScript(path.resolve(desktopDir, "../web/src/lib/composition/api.ts"));
// The desktop-only attachment and backup methods (attachmentsApi.ts, backupApi.ts) ride on the same bridge.
const { ATTACHMENT_METHODS } = await importTypeScript(path.resolve(desktopDir, "../web/src/lib/composition/attachmentsApi.ts"));
const { BACKUP_METHODS } = await importTypeScript(path.resolve(desktopDir, "../web/src/lib/composition/backupApi.ts"));
const expectedBridge = [...API_METHODS, ...ATTACHMENT_METHODS, ...BACKUP_METHODS, "initial", "platform"].sort();

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 20_000, interval = 250 } = {}) {
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

function meiliProcessesFor(dir) {
  try {
    return execFileSync("pgrep", ["-f", dir], { encoding: "utf-8" }).trim().split("\n").filter(Boolean);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
}

console.log(`home:    ${home}\noutput:  ${out}\napp:     ${packaged ?? `${desktopDir} (development build)`}`);

const app = await electron.launch({
  executablePath: packaged ?? electronPath,
  args: packaged ? [`--user-data-dir=${userData}`] : [desktopDir, `--user-data-dir=${userData}`],
  env: { ...process.env, HOME: home },
  // Finder starts apps in `/`, which is read-only. Launching the same way keeps
  // a dependency on the working directory from sneaking back in (it once broke
  // the bundled Meilisearch, which writes ./dumps by default).
  cwd: "/",
});

const consoleProblems = [];
try {
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error" || /Refused to|Content Security Policy/i.test(message.text())) {
      consoleProblems.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));

  await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 30_000 });
  check("the workspace renders over app://", true, page.url());

  // ---- Security posture of the renderer
  const posture = await page.evaluate(() => ({
    bridge: typeof window.composition,
    hasRequire: typeof window.require,
    hasProcess: typeof window.process,
    methods: Object.keys(window.composition ?? {}).sort(),
    theme: document.documentElement.dataset.theme,
  }));
  check("window.composition is exposed", posture.bridge === "object");
  check("Node is not reachable from the page", posture.hasRequire === "undefined" && posture.hasProcess === "undefined");
  const missing = expectedBridge.filter((name) => !posture.methods.includes(name));
  const unexpected = posture.methods.filter((name) => !expectedBridge.includes(name));
  check(
    "the bridge exposes only the API (+ attachments, backup, initial, platform)",
    API_METHODS.length > 0 && missing.length === 0 && unexpected.length === 0,
    missing.length || unexpected.length
      ? `missing: ${missing.join(",") || "none"}; unexpected: ${unexpected.join(",") || "none"}`
      : `${posture.methods.length} members: ${posture.methods.join(",")}`,
  );
  check("the initial theme is applied before paint", posture.theme === "dark", posture.theme);

  // ---- Navigation: desktop has no Docs viewer
  check("no Docs link in the sidebar", (await page.getByRole("link", { name: "Docs" }).count()) === 0);
  check("Settings link is present", (await page.getByRole("link", { name: "Settings" }).count()) === 1);
  await page.screenshot({ path: path.join(out, "1-empty.png") });

  // ---- Create and edit a note; it must reach the real SQLite file
  const sidebar = page.getByRole("navigation", { name: "Notes" });
  await sidebar.getByRole("button", { name: "+ New note" }).click();
  const editor = page.getByLabel("Markdown editor");
  await editor.waitFor();
  const unique = `zebrafinch${Date.now()}`;
  await editor.fill(`---\ntitle: Smoke note\ndescription: ''\ntags: []\n---\n# Heading\n\nHello from the smoke test, ${unique}.\n`);
  await waitFor(
    async () => (await page.evaluate(() => window.composition.loadWorkspace())).notes[0]?.content.includes("Hello from the smoke test"),
    { timeout: 10_000 },
  );
  const workspace = await page.evaluate(() => window.composition.loadWorkspace());
  check("the note is saved (autosave over IPC)", workspace.notes.length === 1 && workspace.notes[0].title === "Smoke note", workspace.notes[0]?.title);
  check("the database is at ~/.composition/composition.db", fs.existsSync(path.join(home, ".composition", "composition.db")));
  await page.screenshot({ path: path.join(out, "2-note.png") });

  // ---- Images: pasted into the editor, stored in ~/.composition/app_data, shown in the preview
  const pasted = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 40;
    const context = canvas.getContext("2d");
    context.fillStyle = "#38a";
    context.fillRect(0, 0, 80, 40);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const data = new Uint8Array(await blob.arrayBuffer());

    // Straight over IPC first: the bytes must survive the bridge as a Uint8Array.
    const [note] = (await window.composition.loadWorkspace()).notes;
    const direct = await window.composition.saveImage({ noteId: note.id, fileName: "direct.png", data });
    const refused = await window.composition.saveImage({ noteId: note.id, fileName: "x.png", data: new Uint8Array([1, 2, 3]) });

    // Then the way a person does it: a paste event carrying an image file.
    const editor = document.querySelector('textarea[aria-label="Markdown editor"]');
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([blob], "Pasted Shot.png", { type: "image/png" }));
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    return { direct, refused };
  });
  check("saveImage stores an image sent over IPC", /^smoke-note-direct-[0-9a-f]{12}\.png$/.test(pasted.direct.name ?? ""), pasted.direct.name ?? pasted.direct.error);
  check("saveImage refuses bytes that aren't an image", typeof pasted.refused.error === "string" && !pasted.refused.name);
  const preview = page.locator(".prose img").first();
  await preview.waitFor({ timeout: 10_000 });
  await waitFor(async () => preview.evaluate((img) => img.complete && img.naturalWidth === 80), { timeout: 10_000 });
  const src = await preview.getAttribute("src");
  check("a pasted image renders in the preview from app://", /^app:\/\/composition\/app_data\/smoke-note-pasted-shot-[0-9a-f]{12}\.png$/.test(src ?? ""), src ?? "");
  const imageDir = path.join(home, ".composition", "app_data");
  check("images are stored in ~/.composition/app_data", fs.existsSync(imageDir) && fs.readdirSync(imageDir).length === 2, fs.existsSync(imageDir) ? fs.readdirSync(imageDir).join(",") : "missing");
  const served = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return { status: response.status, type: response.headers.get("content-type") };
  }, src);
  check("app://…/app_data serves the image as image/png", served.status === 200 && served.type === "image/png", `${served.status} ${served.type}`);
  await waitFor(async () => (await page.evaluate(() => window.composition.loadWorkspace())).notes[0]?.content.includes("](app_data/smoke-note-pasted-shot-"), { timeout: 10_000 });
  check("the note's Markdown refers to the image by its app_data path", true);
  await page.screenshot({ path: path.join(out, "2b-image.png") });

  // ---- Attachments (desktop only): chosen in a native dialog, listed in a table below the note.
  // Playwright can't click an OS dialog, so the main process's dialog and shell functions are
  // replaced; everything from the button press to the file on disk is the real code path.
  const inbox = path.join(home, "inbox");
  fs.mkdirSync(path.join(inbox, "a folder"), { recursive: true });
  const reportFile = path.join(inbox, "Quarterly report.pdf");
  const archiveFile = path.join(inbox, "data.tar.gz");
  fs.writeFileSync(reportFile, "%PDF-1.7 smoke");
  fs.writeFileSync(archiveFile, Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]));
  const copyTarget = path.join(inbox, "copy of report.pdf");
  await app.evaluate(({ dialog, shell }, args) => {
    globalThis.__smokePick = args.pick;
    dialog.showOpenDialog = async () => ({ canceled: globalThis.__smokePick.length === 0, filePaths: globalThis.__smokePick });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: args.copyTarget });
    shell.showItemInFolder = (file) => { globalThis.__smokeRevealed = file; };
  }, { pick: [reportFile, archiveFile], copyTarget });

  const attachments = page.getByRole("region", { name: /^Attachments/ });
  check("a note with no attachments shows the attach button and no table", (await page.getByRole("button", { name: "Attach files" }).count()) === 1 && (await page.getByRole("table").count()) === 0);
  await page.getByRole("button", { name: "Attach files" }).click();
  await attachments.getByRole("table").waitFor({ timeout: 10_000 });
  const rows = attachments.getByRole("row");
  check("attaching two files lists both in a table below the note", (await rows.count()) === 3, `${(await rows.count()) - 1} rows`);
  check("the table shows each file's name", (await attachments.getByText("Quarterly report.pdf").count()) === 1 && (await attachments.getByText("data.tar.gz").count()) === 1);
  check("the table shows each file's size", (await attachments.getByText("14 B").count()) === 1 && (await attachments.getByText("7 B").count()) === 1);
  const attachmentDir = path.join(home, ".composition", "attachments");
  const stored = fs.existsSync(attachmentDir) ? fs.readdirSync(attachmentDir).sort() : [];
  check("the files are copied into ~/.composition/attachments", stored.length === 2 && stored.some((n) => /^[0-9a-f]{12}-Quarterly_report\.pdf$/.test(n)) && stored.some((n) => /\.gz$/.test(n)), stored.join(","));
  check("the originals are left where they were", fs.existsSync(reportFile) && fs.existsSync(archiveFile));
  const listed = await page.evaluate(async () => {
    const [note] = (await window.composition.loadWorkspace()).notes;
    return window.composition.listAttachments(note.id);
  });
  check("attachments persist and list over IPC, without their on-disk names", listed.length === 2 && listed.every((a) => !("storedName" in a)), JSON.stringify(Object.keys(listed[0] ?? {})));
  const panelBox = await attachments.boundingBox();
  const paneBox = await page.getByRole("region", { name: "Smoke note" }).boundingBox();
  check("the table sits at the bottom of the note pane", Boolean(panelBox && paneBox) && Math.abs(panelBox.y + panelBox.height - (paneBox.y + paneBox.height)) < 2, `${panelBox?.y + panelBox?.height} vs ${paneBox?.y + paneBox?.height}`);
  await page.screenshot({ path: path.join(out, "2c-attachments.png") });

  await attachments.getByRole("button", { name: "Show Quarterly report.pdf in Finder" }).click();
  const revealed = await waitFor(() => app.evaluate(() => globalThis.__smokeRevealed));
  check("'Show in Finder' reveals the stored file", revealed.startsWith(attachmentDir) && revealed.endsWith("Quarterly_report.pdf"), revealed);
  await attachments.getByRole("button", { name: "Save a copy of Quarterly report.pdf" }).click();
  await waitFor(async () => fs.existsSync(copyTarget));
  check("'Save a copy' writes the file where the save dialog said", fs.readFileSync(copyTarget, "utf-8") === "%PDF-1.7 smoke");

  // A folder is refused by name; a cancelled dialog does nothing.
  await app.evaluate(({}, folder) => { globalThis.__smokePick = [folder]; }, path.join(inbox, "a folder"));
  await page.getByRole("button", { name: "Attach files" }).click();
  // Scoped to the panel: Next's own route announcer is also a role="alert".
  await attachments.getByRole("alert").filter({ hasText: "a folder: only files can be attached" }).waitFor({ timeout: 10_000 });
  check("a folder is refused, by name, and nothing is added", (await rows.count()) === 3 && fs.readdirSync(attachmentDir).length === 2);
  await app.evaluate(() => { globalThis.__smokePick = []; });
  await page.getByRole("button", { name: "Attach files" }).click();
  await sleep(500);
  check("cancelling the file dialog adds nothing and shows no error", (await rows.count()) === 3 && (await attachments.getByRole("alert").count()) === 0);

  // The renderer can only name an id, never a path.
  const forged = await page.evaluate(async () => {
    try { await window.composition.addAttachments(1, "/etc/passwd"); return "ok"; } catch { return "threw"; }
  });
  check("an extra path argument from the page is ignored", forged === "ok" && fs.readdirSync(attachmentDir).length === 2);
  await app.evaluate(() => { globalThis.__smokePick = ["/etc/hosts"]; });

  await attachments.getByRole("button", { name: "Remove data.tar.gz" }).click();
  await attachments.getByRole("button", { name: "Remove data.tar.gz?" }).click();
  await waitFor(async () => (await rows.count()) === 2);
  check("removing an attachment drops its row and deletes the stored file", fs.readdirSync(attachmentDir).length === 1 && fs.readdirSync(attachmentDir)[0].endsWith("Quarterly_report.pdf"));
  await app.evaluate(() => { globalThis.__smokePick = []; });

  // ---- Groups
  await sidebar.getByRole("button", { name: "+ New group" }).click();
  await page.getByPlaceholder("Group name").fill("Projects");
  await page.getByPlaceholder("Group name").press("Enter");
  await waitFor(async () => (await page.evaluate(() => window.composition.loadWorkspace())).groups.length === 1);
  check("a group can be created", true);

  // moveGroup (nesting groups) over the real IPC path, including the refusal of a loop.
  const moved = await page.evaluate(async () => {
    const parent = await window.composition.createGroup("Parent", null);
    const child = await window.composition.createGroup("Child", null);
    const nested = await window.composition.moveGroup(child.id, parent.id);
    const loop = await window.composition.moveGroup(parent.id, child.id);
    return { parentId: parent.id, nested, loop };
  });
  check("moving a group over IPC reparents it", moved.nested.group?.parentId === moved.parentId);
  check("a move that would create a loop is refused, not thrown", typeof moved.loop.error === "string" && !moved.loop.group);

  // ---- Search through the managed Meilisearch
  const searchResult = await waitFor(
    async () => {
      const result = await page.evaluate((q) => window.composition.searchNotes(q), unique);
      return result.hits.length > 0 ? result : null;
    },
    { timeout: 20_000, interval: 500 },
  ).catch(() => null);
  if (searchResult) {
    check("search finds the note through the bundled Meilisearch", searchResult.hits[0].title === "Smoke note");
  } else {
    const last = await page.evaluate((q) => window.composition.searchNotes(q), unique);
    check("search finds the note through the bundled Meilisearch", false, last.error ?? "no hits");
  }
  check("Meilisearch data lives under the app's user-data dir", fs.existsSync(path.join(userData, "search", "meili_data")));
  const keyMode = fs.existsSync(path.join(userData, "search", "meili_master_key"))
    ? fs.statSync(path.join(userData, "search", "meili_master_key")).mode & 0o777
    : null;
  check("the master key file is owner-only (0600)", keyMode === 0o600, keyMode?.toString(8));

  // ---- Settings screen, client-side navigation, theme change
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  check("client-side navigation to /settings works", page.url().includes("/settings"), page.url());
  check("settings show the database path", (await page.getByText(path.join(home, ".composition", "composition.db")).count()) > 0);
  await page.screenshot({ path: path.join(out, "3-settings-dark.png") });

  await page.getByLabel("Light", { exact: true }).check();
  await waitFor(async () => (await page.evaluate(() => window.composition.loadSettings())).theme === "light");
  check("changing the theme applies it immediately", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
  check("the theme is stored in the app's own settings file", fs.existsSync(path.join(userData, "settings.json")) && JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf-8")).theme === "light");
  check("the web app's settings file was not touched", !fs.existsSync(path.join(home, ".composition-web", "settings.json")));
  await page.screenshot({ path: path.join(out, "4-settings-light.png") });

  // ---- Backup and restore (Settings): dialogs are replaced as above, so the real button, the real
  // main-process code and the real files are exercised; only the OS picker is not.
  const backupFile = path.join(inbox, "smoke-backup.tar.gz");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, backupFile);
  const beforeBackup = await page.evaluate(async () => {
    const workspace = await window.composition.loadWorkspace();
    return { titles: workspace.notes.map((n) => n.title).sort(), theme: (await window.composition.loadSettings()).theme };
  });
  const imagesBefore = fs.readdirSync(imageDir).sort();
  const attachmentsBefore = fs.readdirSync(attachmentDir).sort();

  await page.getByRole("button", { name: "Create backup…" }).click();
  await page.getByRole("status").filter({ hasText: "Backed up" }).waitFor({ timeout: 20_000 });
  check("Create backup writes the file the save dialog chose", fs.existsSync(backupFile) && fs.statSync(backupFile).size > 0);
  const listing = execFileSync("tar", ["-tzf", backupFile], { encoding: "utf-8" }).trim().split("\n");
  check(
    "the backup holds the database, settings, images and attachments",
    ["composition.db", "settings.json", "composition-backup.json"].every((name) => listing.includes(name)) &&
      imagesBefore.every((name) => listing.includes(`app_data/${name}`)) &&
      attachmentsBefore.every((name) => listing.includes(`attachments/${name}`)),
    `${listing.length} entries`,
  );
  check("the backup does not carry the data location", !execFileSync("tar", ["-xzOf", backupFile, "settings.json"], { encoding: "utf-8" }).includes("appDataDir"));

  // Damage everything the backup covers, then restore through the UI.
  await page.evaluate(async () => {
    const api = window.composition;
    const extra = await api.createNote("Written after the backup", null);
    for (const note of (await api.loadWorkspace()).notes) if (note.id !== extra.id) await api.deleteNote(note.id);
    await api.saveTheme("dark");
  });
  for (const name of fs.readdirSync(imageDir)) fs.rmSync(path.join(imageDir, name));
  for (const name of fs.readdirSync(attachmentDir)) fs.rmSync(path.join(attachmentDir, name));

  await page.getByRole("button", { name: "Restore from backup…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Restored" }).waitFor({ timeout: 30_000 });
  const afterRestore = await page.evaluate(async () => {
    const workspace = await window.composition.loadWorkspace();
    return { titles: workspace.notes.map((n) => n.title).sort(), theme: (await window.composition.loadSettings()).theme };
  });
  check("Restore brings the notes back and drops what was written afterwards", JSON.stringify(afterRestore.titles) === JSON.stringify(beforeBackup.titles), afterRestore.titles.join(","));
  check("Restore brings back the images and attachments", JSON.stringify(fs.readdirSync(imageDir).sort()) === JSON.stringify(imagesBefore) && JSON.stringify(fs.readdirSync(attachmentDir).sort()) === JSON.stringify(attachmentsBefore));
  check("Restore brings back the settings and reloads the page with them", afterRestore.theme === beforeBackup.theme && (await page.evaluate(() => document.documentElement.dataset.theme)) === beforeBackup.theme);
  check("the page says what it restored, across the reload", (await page.getByRole("status").filter({ hasText: /Restored .* note/ }).count()) === 1);
  const safety = path.join(home, "Composition Backups");
  check("the data it replaced was saved first", fs.existsSync(safety) && fs.readdirSync(safety).some((n) => n.startsWith("composition-pre-restore-")));
  check("the scratch folders are cleaned up", fs.readdirSync(path.join(home, ".composition")).every((n) => !n.startsWith(".restore-")));
  await page.screenshot({ path: path.join(out, "4b-restored.png") });

  // A file that is not a backup is refused and changes nothing.
  const junk = path.join(inbox, "not-a-backup.tar.gz");
  fs.writeFileSync(junk, "definitely not a backup");
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, junk);
  await page.getByRole("button", { name: "Restore from backup…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "not a Composition backup" }).waitFor({ timeout: 10_000 });
  const afterRefusal = await page.evaluate(async () => (await window.composition.loadWorkspace()).notes.map((n) => n.title).sort());
  check("a file that isn't a backup is refused, and nothing changes", JSON.stringify(afterRefusal) === JSON.stringify(beforeBackup.titles));

  // ---- Back to notes; state survives
  await page.getByRole("link", { name: /Back to notes/ }).click();
  await page.waitForSelector('nav[aria-label="Notes"]');
  check("returning to the notes keeps them", (await page.getByText("Smoke note").count()) > 0);
  await page.screenshot({ path: path.join(out, "5-back-light.png") });

  // Checked before the probe below, which provokes a (correct) CSP violation on purpose.
  check("no console errors or CSP violations", consoleProblems.length === 0, consoleProblems.slice(0, 3).join(" | "));

  // ---- Only stored images are served from app_data (these 404s are logged by Chromium, hence after the check above)
  const refused = await page.evaluate(async () => {
    const status = async (url) => (await fetch(url)).status;
    return {
      traversal: await status("app://composition/app_data/..%2Fcomposition.db"),
      notAnImage: await status("app://composition/app_data/composition.db"),
    };
  });
  check("app://…/app_data refuses anything that isn't a stored image", refused.traversal === 404 && refused.notAnImage === 404, `${refused.traversal}, ${refused.notAnImage}`);

  // ---- The page can't reach outside its own origin or the API
  const isolation = await page.evaluate(async () => {
    const results = {};
    try { await fetch("https://example.com/", { mode: "no-cors" }); results.fetch = "allowed"; } catch { results.fetch = "blocked"; }
    results.evilMethod = typeof window.composition.notAMethod;
    return results;
  });
  if (process.env.COMPOSITION_DEV_URL) {
    // The CSP is set by the app:// handler; in dev the page comes from `next dev`.
    console.log("SKIP  the CSP blocks script network access  (development server, no app:// handler)");
  } else {
    check("the CSP blocks script network access (connect-src 'self')", isolation.fetch === "blocked", isolation.fetch);
  }
  check("the bridge has no extra methods", isolation.evilMethod === "undefined");

} catch (error) {
  console.error(error);
  failures.push(`unexpected error: ${error.message}`);
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, "failure.png") });
  } catch {
    // no window to capture
  }
} finally {
  await Promise.race([app.close().catch(() => {}), sleep(15_000)]);
}

// ---- Shutdown must leave nothing behind
await sleep(1000);
const leftovers = meiliProcessesFor(path.join(userData, "search", "meili_data"));
check("quitting leaves no Meilisearch process behind", leftovers.length === 0, leftovers.join(","));
check("the pid file is removed on quit", !fs.existsSync(path.join(userData, "search", "meili.pid")));

fs.rmSync(home, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll checks passed.");
console.log(`screenshots: ${out}`);
process.exit(failures.length ? 1 : 0);
