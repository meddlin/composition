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
import { _electron as electron } from "playwright-core";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = process.env.SMOKE_EXECUTABLE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-smoke-"));
const userData = path.join(home, "userData");
const out = process.env.SMOKE_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "composition-smoke-shots-"));
fs.mkdirSync(out, { recursive: true });

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
  check("the bridge exposes only the API (+ initial, platform)", posture.methods.length === 16, posture.methods.join(","));
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

  // ---- Back to notes; state survives
  await page.getByRole("link", { name: /Back to notes/ }).click();
  await page.waitForSelector('nav[aria-label="Notes"]');
  check("returning to the notes keeps them", (await page.getByText("Smoke note").count()) > 0);
  await page.screenshot({ path: path.join(out, "5-back-light.png") });

  // Checked before the probe below, which provokes a (correct) CSP violation on purpose.
  check("no console errors or CSP violations", consoleProblems.length === 0, consoleProblems.slice(0, 3).join(" | "));

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
