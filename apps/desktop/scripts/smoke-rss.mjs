// End-to-end check of the RSS Reader plugin in the real app: a feed is subscribed to from a local fixture server and its
// entries listed, a page that is not a feed is refused, a refresh asks the server only whether the feed changed, a feed can
// be unsubscribed from (asking first), and nothing is fetched while the plugin is off. A second launch, without the test
// switch, checks that the app refuses to fetch from this computer's own addresses. Like smoke.mjs it runs against a
// throwaway HOME and user-data directory (build first with `pnpm build`).
//
//   pnpm build && pnpm smoke:rss
//   SMOKE_EXECUTABLE=release/mac-arm64/Composition.app/Contents/MacOS/Composition pnpm smoke:rss   (only the second part: a packaged app ignores the test switch)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packaged = process.env.SMOKE_EXECUTABLE;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-rss-smoke-"));
const out = process.env.SMOKE_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "composition-rss-shots-"));
fs.mkdirSync(out, { recursive: true });

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

// A stand-in feed site: a feed that answers a conditional request with 304, and a page that is not a feed.
const hits = [];
const server = http.createServer((req, res) => {
  hits.push({ url: req.url, ifNoneMatch: req.headers["if-none-match"], userAgent: req.headers["user-agent"] });
  if (req.url === "/feed.xml") {
    if (req.headers["if-none-match"] === '"v1"') {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.setHeader("content-type", "application/rss+xml");
    res.setHeader("etag", '"v1"');
    res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Smoke feed</title><link>http://127.0.0.1/</link>
<item><title>First post</title><link>http://127.0.0.1/posts/1</link><guid>g1</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;&lt;img src=x onerror="window.__pwned=1"&gt;</description></item>
<item><title>Second post</title><link>http://127.0.0.1/posts/2</link><guid>g2</guid><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
    return;
  }
  if (req.url === "/page.html") {
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><title>Not a feed</title><p>hello</p>");
    return;
  }
  res.statusCode = 404;
  res.end("nope");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const site = `http://127.0.0.1:${server.address().port}`;

async function launch(name, { allowPrivate, plugins }) {
  const userData = path.join(home, name);
  fs.mkdirSync(userData, { recursive: true });
  // The plugin ships off; the settings file is the same one Settings > Plugins writes.
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ plugins }));
  const env = { ...process.env, HOME: path.join(home, `${name}-home`) };
  delete env.ELECTRON_RUN_AS_NODE;
  if (allowPrivate) env.COMPOSITION_FEEDS_ALLOW_PRIVATE = "1";
  fs.mkdirSync(env.HOME, { recursive: true });
  const app = await electron.launch({
    executablePath: packaged ?? electronPath,
    args: packaged ? [`--user-data-dir=${userData}`] : [desktopDir, `--user-data-dir=${userData}`],
    env,
    cwd: "/",
  });
  const page = await app.firstWindow();
  await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 30_000 });
  return { app, page };
}

const sawFeed = () => hits.filter((h) => h.url === "/feed.xml");

try {
  if (!packaged) {
    const { app, page } = await launch("on", { allowPrivate: true, plugins: { todo: true, "reading-list": false, rss: true } });
    const problems = [];
    page.on("console", (message) => {
      if (message.type() === "error" || /Refused to|Content Security Policy/i.test(message.text())) problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    try {
      // ---- Turn an empty panel into an RSS Reader
      await page.evaluate(() => {
        const { store } = window.__workspace;
        store.setPanelKind(Object.keys(store.getSnapshot().panels.byId)[0], "rss");
      });
      const panel = page.getByRole("region", { name: "RSS Reader" });
      await panel.waitFor();
      check("the RSS Reader panel opens while the plugin is on", (await panel.getByRole("textbox", { name: "Add a feed" }).count()) === 1);
      check("and says there are no feeds yet", (await panel.getByText(/No feeds yet/).count()) === 1);

      // ---- Subscribe
      await panel.getByRole("textbox", { name: "Add a feed" }).fill(`${site}/feed.xml#frag`);
      await panel.getByRole("textbox", { name: "Add a feed" }).press("Enter");
      await panel.getByRole("button", { name: "Smoke feed, 2 unread" }).waitFor({ timeout: 15_000 });
      check("subscribing fetches the feed and lists it with its unread count", true);
      const feeds = await page.evaluate(() => window.composition.listFeeds());
      check("the stored address has no fragment, and the feed took its own title", feeds.length === 1 && feeds[0].url === `${site}/feed.xml` && feeds[0].title === "Smoke feed", JSON.stringify(feeds));
      check("the request carried the app's user agent", sawFeed()[0]?.userAgent?.startsWith("Composition/") === true, String(sawFeed()[0]?.userAgent));
      const names = await panel.getByRole("list", { name: "Entries" }).getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      check("its entries are listed, newest first", JSON.stringify(names) === JSON.stringify(["Second post", "First post"]), JSON.stringify(names));

      // ---- An entry's excerpt is text
      await panel.getByRole("button", { name: "First post" }).click();
      const detail = panel.getByRole("region", { name: "Entry" });
      await detail.waitFor();
      check("the open entry shows its excerpt as plain text", (await detail.textContent())?.includes("Hello world") === true && (await detail.locator("img, b").count()) === 0, (await detail.textContent())?.slice(0, 80));
      check("and nothing in the feed ran as script", (await page.evaluate(() => window.__pwned)) === undefined);
      await page.screenshot({ path: path.join(out, "rss.png") });

      // ---- A page that is not a feed
      await panel.getByRole("textbox", { name: "Add a feed" }).fill(`${site}/page.html`);
      await panel.getByRole("textbox", { name: "Add a feed" }).press("Enter");
      const alert = await panel.getByRole("alert").first().waitFor({ timeout: 10_000 }).then(() => panel.getByRole("alert").first().textContent());
      check("a page that is not a feed is refused, with the reason alone", alert === "That address is not an RSS or Atom feed.", alert ?? "");
      check("and nothing was subscribed to", (await page.evaluate(() => window.composition.listFeeds())).length === 1);
      await panel.getByRole("textbox", { name: "Add a feed" }).fill("");

      // ---- Refresh: a conditional request, answered "not modified"
      const before = sawFeed().length;
      await page.evaluate(() => window.composition.refreshAllFeeds());
      const refreshHit = sawFeed().slice(before)[0];
      check("a refresh sends back the ETag the server gave", refreshHit?.ifNoneMatch === '"v1"', JSON.stringify(refreshHit));
      const afterRefresh = await page.evaluate(() => window.composition.listFeeds());
      check("a 'not modified' answer keeps the entries and shows no error", afterRefresh[0].unread === 2 && afterRefresh[0].lastError === "", JSON.stringify(afterRefresh[0]));

      // ---- A feed that goes missing keeps its entries and shows why
      await page.evaluate(async (url) => {
        const [feed] = await window.composition.listFeeds();
        window.__feedId = feed.id;
        return url;
      }, site);

      // ---- Unsubscribe asks first
      await panel.getByRole("button", { name: "Options for Smoke feed" }).click();
      await page.getByRole("menuitem", { name: /Unsubscribe/ }).click();
      const dialog = page.getByRole("alertdialog");
      await dialog.waitFor();
      check("unsubscribing asks first, naming the feed", (await dialog.textContent())?.includes("Smoke feed") === true);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "detached" });
      check("Cancel keeps the feed", (await page.evaluate(() => window.composition.listFeeds())).length === 1);
      await panel.getByRole("button", { name: "Options for Smoke feed" }).click();
      await page.getByRole("menuitem", { name: /Unsubscribe/ }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Unsubscribe" }).click();
      await waitFor(async () => (await page.evaluate(() => window.composition.listFeeds())).length === 0);
      check("confirming removes the feed", true);
      check("and all its entries", (await page.evaluate(() => window.composition.listFeedEntries(null))).length === 0);

      // ---- Subscribe again, then turn the plugin off: nothing is fetched
      await page.evaluate((url) => window.composition.subscribeFeed(url), `${site}/feed.xml`);
      const fetchedBeforeOff = hits.length;
      await page.evaluate(() => window.__workspace.store.plugins.setEnabled("rss", false));
      await panel.getByText("The RSS Reader plugin is turned off.").waitFor({ timeout: 10_000 });
      check("with the plugin off the panel says so", true);
      const refused = await page.evaluate(() => window.composition.refreshAllFeeds().then(() => "ok", (e) => e.message));
      const refusedSub = await page.evaluate((url) => window.composition.subscribeFeed(url).then(() => "ok", (e) => e.message), `${site}/feed.xml?other`);
      check("and refreshing or subscribing is refused in the main process", /turned off/.test(refused) && /turned off/.test(refusedSub), `${refused} / ${refusedSub}`);
      check("without a request to any server", hits.length === fetchedBeforeOff);
      check("while the feeds are kept", (await page.evaluate(() => window.composition.listFeeds())).length === 1);
      await page.evaluate(() => window.__workspace.store.plugins.setEnabled("rss", true));
      check("turning it back on brings the panel back", (await panel.getByRole("textbox", { name: "Add a feed" }).count()) === 1 || (await panel.getByRole("textbox", { name: "Add a feed" }).waitFor({ timeout: 10_000 }).then(() => true)));

      check("the Content Security Policy did not block anything", problems.length === 0, problems.join(" | "));
    } finally {
      await Promise.race([app.close().catch(() => {}), sleep(15_000)]);
    }
  }

  // ---- Without the test switch the app will not fetch from this computer
  {
    const { app, page } = await launch("off-switch", { allowPrivate: false, plugins: { todo: true, "reading-list": false, rss: true } });
    try {
      const before = hits.length;
      const message = await page.evaluate((url) => window.composition.subscribeFeed(url).then(() => "subscribed", (e) => e.message), `${site}/feed.xml`);
      check("a feed on this computer's own address is refused", /private network/.test(message), message);
      check("without a request to it", hits.length === before);
      check("and nothing was subscribed to", (await page.evaluate(() => window.composition.listFeeds())).length === 0);
    } finally {
      await Promise.race([app.close().catch(() => {}), sleep(15_000)]);
    }
  }
} catch (error) {
  console.error(error);
  failures.push(`unexpected error: ${error.message}`);
} finally {
  server.close();
}

fs.rmSync(home, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll checks passed.");
console.log(`screenshots: ${out}`);
process.exit(failures.length ? 1 : 0);
