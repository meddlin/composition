// End-to-end check of the Reading List plugin in the real app: a web view loads a page from a local fixture server, in the
// Reading List's own session, with no bridge and no Node; nothing attaches while the plugin is off; the panel keys still
// work while a page has focus; the same holds in a pop-out. Like smoke.mjs it runs against a throwaway HOME and user-data
// directory (build first with `pnpm build`).
//
//   pnpm build && pnpm smoke:reading-list
//   SMOKE_EXECUTABLE=release/mac-arm64/Composition.app/Contents/MacOS/Composition pnpm smoke:reading-list
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = process.env.SMOKE_EXECUTABLE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-reading-smoke-"));
const userData = path.join(home, "userData");
const out = process.env.SMOKE_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "composition-reading-shots-"));
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(out, { recursive: true });
// The plugin ships off; the settings file is the same one Settings > Plugins writes.
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ plugins: { todo: true, "reading-list": true } }));

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, { timeout = 20_000, interval = 200 } = {}) {
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

// A stand-in article site. It forbids framing, as most real ones do, and reports what its page can see of the app.
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  res.setHeader("content-type", "text/html");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("content-security-policy", "frame-ancestors 'none'");
  res.end(`<!doctype html><title>Fixture article ${req.url}</title><body><h1>Fixture</h1><a id="next" href="/second">next</a>
<script>document.cookie = "reading=1; path=/"; document.body.dataset.probe = JSON.stringify({ composition: typeof window.composition, require: typeof require, process: typeof process });</script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const site = `http://127.0.0.1:${server.address().port}`;

const app = await electron.launch({
  executablePath: packaged ?? electronPath,
  args: packaged ? [`--user-data-dir=${userData}`] : [desktopDir, `--user-data-dir=${userData}`],
  env: { ...process.env, HOME: home },
  cwd: "/",
});

const consoleProblems = [];
/** The pages of web views the app holds now (not windows of ours), by address. */
const guests = () =>
  app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().filter((c) => c.getType() === "webview").map((c) => ({ id: c.id, url: c.getURL(), partition: c.session.storagePath ?? "" })),
  );
const guestEval = (id, code) => app.evaluate(({ webContents }, [guestId, source]) => webContents.fromId(guestId).executeJavaScript(source), [id, code]);

try {
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error" || /Refused to|Content Security Policy/i.test(message.text())) consoleProblems.push(message.text());
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 30_000 });

  // ---- Turn an empty panel into a Reading List
  const panelId = await page.evaluate(() => {
    const { store } = window.__workspace;
    const id = Object.keys(store.getSnapshot().panels.byId)[0];
    store.setPanelKind(id, "reading-list");
    return id;
  });
  const panel = page.getByRole("region", { name: "Reading List" });
  await panel.waitFor();
  check("the Reading List panel opens while the plugin is on", (await panel.getByRole("textbox", { name: "Add a link" }).count()) === 1);

  // ---- Add a link: its page loads in a web view
  await panel.getByRole("textbox", { name: "Add a link" }).fill(`${site}/article#frag`);
  await panel.getByRole("textbox", { name: "Add a link" }).press("Enter");
  await waitFor(async () => (await guests()).some((g) => g.url === `${site}/article`));
  const [guest] = (await guests()).filter((g) => g.url === `${site}/article`);
  check("the page of the link loads in a web view even though it forbids framing", guest.url === `${site}/article`, guest.url);
  check("and the fragment was dropped from the stored link", (await page.evaluate(() => window.composition.listReadingItems()))[0]?.url === `${site}/article`);
  check("the Content Security Policy did not block the web view", consoleProblems.length === 0, consoleProblems.join(" | "));
  const named = await waitFor(async () => (await panel.getByRole("button", { name: "Fixture article /article", exact: true }).count()) === 1, { timeout: 8000 }).catch(() => false);
  check("the link is named after its page once it has loaded", Boolean(named), JSON.stringify((await page.evaluate(() => window.composition.listReadingItems()))[0]));
  check(
    "the title was saved, so it survives a restart",
    (await page.evaluate(() => window.composition.listReadingItems()))[0]?.title === "Fixture article /article",
  );

  // ---- Isolation of the guest page
  const probe = JSON.parse(await guestEval(guest.id, "document.body.dataset.probe"));
  check("the bridge is not defined inside the page", probe.composition === "undefined", JSON.stringify(probe));
  check("and neither is Node", probe.require === "undefined" && probe.process === "undefined");
  check("a notification permission is refused", (await guestEval(guest.id, "Notification.requestPermission()")) === "denied");
  const cookies = await app.evaluate(({ session }) => session.fromPartition("persist:reading-list").cookies.get({}).then((list) => list.map((c) => c.name)));
  const appCookies = await app.evaluate(({ session }) => session.defaultSession.cookies.get({}).then((list) => list.map((c) => c.name)));
  check("its cookie went to the Reading List's own session, not the app's", cookies.includes("reading") && !appCookies.includes("reading"), `${cookies} / ${appCookies}`);
  await page.screenshot({ path: path.join(out, "reading-list.png") });

  // ---- A page asking for a window gets the browser, not a window of ours
  const windowsBefore = app.windows().length;
  const opened = await app.evaluate(async ({ shell, webContents }, guestId) => {
    const calls = [];
    shell.openExternal = async (url) => void calls.push(url);
    await webContents.fromId(guestId).executeJavaScript("window.open('https://example.com/out', '_blank'); 0", true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return calls;
  }, guest.id);
  check("window.open in the page goes to the user's browser", opened.length === 1 && opened[0] === "https://example.com/out", JSON.stringify(opened));
  check("and opens no window of ours", app.windows().length === windowsBefore);

  // ---- A page cannot send the view to the app's own pages
  const stayed = await app.evaluate(async ({ webContents }, guestId) => {
    const guestContents = webContents.fromId(guestId);
    await guestContents.executeJavaScript("location.href = 'file:///etc/hosts'; 0").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 700));
    return guestContents.getURL();
  }, guest.id);
  check("navigating the view to a file:// address is stopped", stayed.startsWith("http://127.0.0.1"), stayed);

  // ---- Keys: the panel commands still work while the page has focus (risk 1 of the plan)
  const panelCount = () => page.evaluate(() => Object.keys(window.__workspace.store.getSnapshot().panels.byId).length);
  const before = await panelCount();
  await app.evaluate(({ webContents }, guestId) => {
    const guestContents = webContents.fromId(guestId);
    guestContents.focus();
    const modifiers = [process.platform === "darwin" ? "meta" : "control", "shift"];
    guestContents.sendInputEvent({ type: "keyDown", keyCode: "\\", modifiers });
    guestContents.sendInputEvent({ type: "keyUp", keyCode: "\\", modifiers });
  }, guest.id);
  const keyWorked = await waitFor(async () => (await panelCount()) === before + 1, { timeout: 3000 }).catch(() => false);
  check("Mod+Shift+\\ pressed inside the page splits the panel", Boolean(keyWorked), `${before} -> ${await panelCount()}`);

  // ---- A divider held over the page lets pointer events through it
  const shielded = await page.evaluate(async () => {
    document.body.setAttribute("data-resizing", "");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const style = document.querySelector("webview")?.parentElement?.style.pointerEvents;
    document.body.removeAttribute("data-resizing");
    return style;
  });
  check("the view stops swallowing the mouse while a divider is dragged", shielded === "none", String(shielded));

  // ---- A forged web view is refused or forced into isolation
  const forged = await page.evaluate(async (src) => {
    const view = document.createElement("webview");
    view.setAttribute("src", src);
    view.setAttribute("nodeintegration", "");
    view.setAttribute("preload", "file:///etc/hosts");
    view.setAttribute("allowpopups", "");
    view.setAttribute("partition", "persist:forged");
    document.body.appendChild(view);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return true;
  }, `${site}/forged`);
  const afterForge = await guests();
  const forgedGuest = afterForge.find((g) => g.url.endsWith("/forged"));
  if (forgedGuest) {
    const forgedProbe = JSON.parse(await guestEval(forgedGuest.id, "document.body.dataset.probe"));
    check("a forged web view still gets no bridge and no Node", forged && forgedProbe.composition === "undefined" && forgedProbe.require === "undefined" && forgedProbe.process === "undefined");
    const forgedCookies = await app.evaluate(({ session }) => session.fromPartition("persist:forged").cookies.get({}).then((list) => list.length));
    check("and is kept in the Reading List's session, not the one it named", forgedCookies === 0);
  } else {
    check("a forged web view is not attached at all", true);
  }
  check("a web view that names another session is refused", !forgedGuest);
  await page.evaluate(() => document.querySelectorAll("webview").forEach((v) => v.src.endsWith("/forged") && v.remove()));
  // One that names no session would land in the app's own, so it is refused too.
  await page.evaluate(async (src) => {
    const view = document.createElement("webview");
    view.setAttribute("src", src);
    document.body.appendChild(view);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    view.remove();
  }, `${site}/no-partition`);
  check("a web view that names no session is refused, so it can't share the app's", !(await guests()).some((g) => g.url.endsWith("/no-partition")) && !hits.includes("/no-partition"));

  // ---- A pop-out: the panel is pulled out, and its page loads there
  const popoutId = await page.evaluate((id) => window.__workspace.store.movePanelToNewWindow(id), panelId);
  const popoutPage = await waitFor(() => app.windows().find((w) => w.url().includes("/popout/") && !w.isClosed()), { timeout: 30_000 });
  await popoutPage.getByRole("region", { name: "Reading List" }).waitFor();
  await popoutPage.getByRole("region", { name: "Reading List" }).getByRole("button", { name: /^Fixture article/ }).first().click();
  await waitFor(async () => (await guests()).some((g) => g.url === `${site}/article`), { timeout: 15_000 });
  check("the panel's page also loads in a pop-out", Boolean(popoutId));
  const [popGuest] = (await guests()).filter((g) => g.url === `${site}/article`);
  const popProbe = JSON.parse(await guestEval(popGuest.id, "document.body.dataset.probe"));
  check("with no bridge there either", popProbe.composition === "undefined" && popProbe.require === "undefined");

  // ---- Turning the plugin off: no page, and nothing attaches
  const guestsBeforeOff = (await guests()).length;
  await page.evaluate(() => window.__workspace.store.plugins.setEnabled("reading-list", false));
  await waitFor(async () => (await guests()).length === 0, { timeout: 10_000 }).catch(() => {});
  check("with the plugin off no page is loaded in any window", (await guests()).length === 0, `${guestsBeforeOff} before`);
  check("the panel says it is off, and keeps its links", (await popoutPage.getByText("The Reading List plugin is turned off.").count()) === 1 && (await page.evaluate(() => window.composition.listReadingItems())).length === 1);
  const requestsBefore = hits.length;
  await page.evaluate(async (src) => {
    const view = document.createElement("webview");
    view.setAttribute("src", src);
    document.body.appendChild(view);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    view.remove();
  }, `${site}/while-off`);
  check("and a web view added by hand is refused while it is off", !hits.slice(requestsBefore).includes("/while-off") && (await guests()).length === 0);

  // ---- Clear browsing data: the session is wiped, the links are kept
  await page.evaluate(() => window.__workspace.store.plugins.setEnabled("reading-list", true));
  await page.evaluate(() => window.composition.clearReadingData());
  const cookiesAfter = await app.evaluate(({ session }) => session.fromPartition("persist:reading-list").cookies.get({}).then((list) => list.length));
  check("Clear browsing data wipes the session's cookies", cookiesAfter === 0, String(cookiesAfter));
  check("and keeps the links", (await page.evaluate(() => window.composition.listReadingItems())).length === 1);
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
  server.close();
}

fs.rmSync(home, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll checks passed.");
console.log(`screenshots: ${out}`);
process.exit(failures.length ? 1 : 0);
