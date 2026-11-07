/**
 * Drives the production web app (already running, pointed at one sample database) in headless Chromium and records how
 * long things take. Normally started by run-suite.sh; by hand:
 *
 *   node measure.mjs <label> <port> <out.json> [sections]
 *
 * sections: comma list of load,sidebar,open,typing,autosave,pages,linkpicker,heavy (default: all but heavy). `heavy` opens
 * the big edge-case notes in every editor tab and needs the full (not --no-huge) database.
 *
 * Environment:
 *   REGULAR_TITLE      the ordinary note to open and type in (run-suite.sh picks one with pick-regular.mjs)
 *   COLLAPSE_FIRST=1   collapse every group right after loading, as a user working around the slow sidebar would
 *   STEP_TIMEOUT_MS    longest any one step may take before it is recorded as failed (default 240000)
 *   TYPE_BUDGET_MS     stop typing in a step once this much time is spent (default 60000), so a slow database still yields numbers
 *   ACTION_TIMEOUT_MS  Playwright's per-action timeout (default 180000)
 *   HEAVY_ONLY         with `heavy`: only notes whose title contains one of these, separated by |
 *
 * Every measured step is guarded: a hang past its timeout or a tab crash is recorded as a result, not an abort.
 * Requires Playwright (not a dependency of apps/web): `npm i -g playwright && npx playwright install chromium`, and
 * NODE_PATH pointing at the global modules if it is not found. The browser runs with --no-sandbox (usual in containers;
 * it only ever opens localhost) and a raised V8 heap limit, so memory does not end a run before the app's own limits would.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

// Playwright is not a dependency of apps/web. It is loaded through the CommonJS resolver, because that one honors
// NODE_PATH (a global install) and an ES `import` does not.
const loadCommonJs = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = loadCommonJs("playwright"));
} catch {
  console.error("Playwright is not installed. Run `npm i -g playwright && npx playwright install chromium`, and set NODE_PATH to the global node_modules.");
  process.exit(2);
}

const [, , label, port = "3100", outFile = `results-${label}.json`, sectionArg] = process.argv;
const BASE = `http://127.0.0.1:${port}`;
const WANT = new Set((sectionArg || "load,sidebar,open,typing,autosave,pages,linkpicker").split(","));
const STEP_TIMEOUT = Number(process.env.STEP_TIMEOUT_MS || 240000);
const TYPE_BUDGET = Number(process.env.TYPE_BUDGET_MS || 60000);
const results = { label, startedAt: new Date().toISOString(), steps: [], notes: [] };

const log = (...a) => console.log(`[${label}]`, ...a);
const save = () => fs.writeFileSync(outFile, JSON.stringify(results, null, 2));

const INIT = () => {
  window.__long = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__long.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  window.__fetches = [];
  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    const t0 = performance.now();
    const action = init && init.headers && (init.headers["Next-Action"] || init.headers["next-action"]);
    const res = await realFetch.apply(this, arguments);
    if (action && init && init.method === "POST") {
      const reqBytes = typeof init.body === "string" ? init.body.length : 0;
      res.clone().arrayBuffer().then((b) => window.__fetches.push({ ms: Math.round(performance.now() - t0), reqKB: Math.round(reqBytes / 1024), resKB: Math.round(b.byteLength / 1024), status: res.status }));
    }
    return res;
  };
  window.__frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));
  // Resolves once no long task has ended for `ms` (or after `max`), returning when the last one ended.
  window.__quiet = (ms, max) =>
    new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        const last = window.__long.length ? window.__long[window.__long.length - 1] : null;
        const lastEnd = last ? last[0] + last[1] : 0;
        const now = performance.now();
        if (now - Math.max(lastEnd, start) >= ms || now - start > max) resolve(lastEnd);
        else setTimeout(tick, 50);
      };
      tick();
    });
};

let browser;
let page;
let consoleErrors = [];
let crashed = false;

async function launch() {
  if (browser) await browser.close().catch(() => {});
  browser = await chromium.launch({ args: ["--no-sandbox", "--disable-frame-rate-limit", "--disable-gpu-vsync", "--js-flags=--max-old-space-size=8192"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.addInitScript(INIT);
  page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.ACTION_TIMEOUT_MS || 180000));
  crashed = false;
  page.on("crash", () => (crashed = true));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`console.error: ${m.text().slice(0, 300)}`));
}

const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${ms / 1000}s: ${what}`)), ms))]);

/**
 * Runs `action`, waits for `ready`, then for the page to go quiet; records wall time to responsive, main-thread blocking
 * (long tasks) and any errors. Never throws.
 */
async function step(name, action, { ready, timeout = STEP_TIMEOUT, extra } = {}) {
  const entry = { name };
  const errorsBefore = consoleErrors.length;
  try {
    if (crashed) throw new Error("page had crashed");
    const mark = await withTimeout(page.evaluate(() => ({ i: window.__long.length, t: performance.now() })), Number(process.env.ACTION_TIMEOUT_MS || 180000), "page unresponsive before step");
    const t0 = Date.now();
    await withTimeout(
      (async () => {
        await action();
        if (ready) await ready();
        // This evaluate can only run when the main thread is free: it marks when the page is responsive again.
        await page.evaluate(() => window.__frame());
      })(),
      timeout,
      name,
    );
    entry.ms = Date.now() - t0;
    const quiet = await withTimeout(page.evaluate(([i]) => window.__quiet(300, 60000).then(() => ({ long: window.__long.slice(i) })), [mark.i]), 240000, "settle");
    const long = quiet.long;
    entry.blockedMs = Math.round(long.reduce((s, [, d]) => s + d, 0));
    entry.longTasks = long.length;
    entry.maxLongMs = Math.round(long.reduce((m, [, d]) => Math.max(m, d), 0));
    if (extra) Object.assign(entry, await extra());
  } catch (error) {
    entry.failed = String(error.message || error).split("\n")[0];
    if (crashed) entry.failed += " [TAB CRASHED]";
  }
  const newErrors = consoleErrors.slice(errorsBefore);
  if (newErrors.length) entry.errors = [...new Set(newErrors)].slice(0, 3);
  results.steps.push(entry);
  save();
  log(entry.failed ? "FAIL" : "ok  ", name.padEnd(58), entry.failed ?? `${entry.ms} ms, blocked ${entry.blockedMs} ms (${entry.longTasks} long, max ${entry.maxLongMs})`, entry.errors ? `ERRORS ${JSON.stringify(entry.errors)}` : "");
  return entry;
}

async function recover(reason) {
  log("recovering:", reason);
  results.notes.push(`recovered (${reason})`);
  await launch();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 300000 });
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s[s.length - 1]), mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length) };
};

async function cdpMetrics() {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  await cdp.detach();
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { domNodes: m.Nodes, jsHeapMB: Math.round(m.JSHeapUsedSize / 1048576), jsHeapTotalMB: Math.round(m.JSHeapTotalSize / 1048576), layoutCount: m.LayoutCount, scriptSec: +m.ScriptDuration.toFixed(2), taskSec: +m.TaskDuration.toFixed(2) };
}

/** Types `text` one key at a time; each key's latency is press -> two animation frames. */
async function typeKeys(text, budgetMs = TYPE_BUDGET) {
  const lat = [];
  const began = Date.now();
  for (const ch of text) {
    // A database slow enough to need minutes for a sentence still gets measured: stop once the budget is spent.
    if (Date.now() - began > budgetMs) break;
    const t0 = Date.now();
    await page.keyboard.type(ch);
    await page.evaluate(() => window.__frame());
    lat.push(Date.now() - t0);
  }
  return lat;
}

async function typingStep(name, focus, text = "stress test typing 123", opts = {}) {
  let lat = [];
  const entry = await step(
    name,
    async () => {
      await focus();
      lat = await typeKeys(text);
    },
    { timeout: opts.timeout ?? STEP_TIMEOUT, extra: async () => ({ keyLatencyMs: stats(lat) }) },
  );
  if (entry.failed && lat.length) entry.keyLatencyMs = stats(lat);
  return entry;
}

const MD = 'textarea[aria-label="Markdown editor"]';
const tab = (n) => page.click(`[role=tab]:has-text("${n}")`);

async function focusMarkdown() {
  // Not at the left edge: the Headings rail (30 px) covers it on any note that has headings.
  await page.click(MD, { position: { x: 200, y: 200 } });
  await page.keyboard.press("Control+End");
}
async function focusLive() {
  await page.click(".cm-content", { position: { x: 200, y: 10 } });
  await page.keyboard.press("Control+End");
}

/** Scrolls the sidebar row for `title` into view and clicks it, like a user would. */
async function openNote(title, ready) {
  const rect = await page.evaluate((t) => {
    const rows = document.querySelectorAll('nav[aria-label="Notes"] button');
    for (const b of rows) {
      if (b.textContent.startsWith(t + "Updated") || b.textContent.startsWith(t + "Created") || b.textContent === t) {
        b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect();
        return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
      }
    }
    return null;
  }, title);
  if (!rect) throw new Error(`no sidebar row for "${title}"`);
  await page.mouse.click(rect.x, rect.y);
  await page.waitForSelector(`section[aria-label="${title.replace(/"/g, '\\"')}"]`, { timeout: 60000 });
  if (ready) await ready();
}

async function firstRegularTitle() {
  if (process.env.REGULAR_TITLE) return process.env.REGULAR_TITLE;
  return page.evaluate(() => {
    for (const b of document.querySelectorAll('nav[aria-label="Notes"] button')) {
      const t = b.textContent;
      const m = /^(.*?)(Updated|Created) /.exec(t);
      if (m && !t.startsWith("EDGE") && !t.startsWith("Actions") && !t.startsWith("Delete") && m[1].length > 3 && m[1].length < 60) return m[1];
    }
    return null;
  });
}

(async () => {
  await launch();

  // ------------------------------------------------------------------------------------------------ load
  if (WANT.has("load")) {
    const entry = { name: "load /" };
    try {
      // Server side, as a bare HTTP client sees it.
      const t0 = Date.now();
      const res = await fetch(BASE + "/", { headers: { "accept-encoding": "identity" } });
      let bodyBytes = 0;
      for await (const chunk of res.body) bodyBytes += chunk.length;
      entry.httpStatus = res.status;
      entry.htmlMB = +(bodyBytes / 1048576).toFixed(1);
      entry.httpTotalMs = Date.now() - t0;

      const nav0 = Date.now();
      await page.goto(BASE + "/", { waitUntil: "commit", timeout: 300000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 300000 });
      entry.domContentLoadedMs = Date.now() - nav0;
      await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 300000 });
      entry.sidebarVisibleMs = Date.now() - nav0;
      // Hydrated = the first control that needs React answers: the sort menu opens.
      await withTimeout(
        (async () => {
          for (;;) {
            await page.click('button[aria-label^="Sort notes"]', { timeout: 300000 });
            if (await page.locator('[role=menu]').count()) break;
            await page.waitForTimeout(100);
          }
        })(),
        300000,
        "hydration",
      );
      entry.interactiveMs = Date.now() - nav0;
      await page.keyboard.press("Escape");
      await page.waitForLoadState("load", { timeout: 300000 });
      entry.loadEventMs = Date.now() - nav0;
      const nav = await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        return { transferMB: +(n.transferSize / 1048576).toFixed(1), decodedMB: +(n.decodedBodySize / 1048576).toFixed(1), fcpMs: fcp ? Math.round(fcp.startTime) : null, longTasks: window.__long.length, blockedMs: Math.round(window.__long.reduce((s, [, d]) => s + d, 0)), maxLongMs: Math.round(window.__long.reduce((m, [, d]) => Math.max(m, d), 0)) };
      });
      Object.assign(entry, nav, await cdpMetrics());
      entry.sidebarRows = await page.evaluate(() => document.querySelectorAll('nav[aria-label="Notes"] [role=group] , nav[aria-label="Notes"] button').length);
    } catch (error) {
      entry.failed = String(error.message).split("\n")[0] + (crashed ? " [TAB CRASHED]" : "");
    }
    entry.errors = consoleErrors.slice(0, 5);
    results.steps.push(entry);
    save();
    log("load", JSON.stringify(entry));
    if (entry.failed) {
      log("cannot continue after a failed load");
      await browser.close();
      return;
    }
    // A page that needed minutes to hydrate may still be re-rendering (React redoes a tree whose hydration failed).
    // Measuring before it is idle would time that work, and a click that "timed out" can still land afterwards.
    const idleStart = Date.now();
    await withTimeout(page.evaluate(() => window.__quiet(5000, 1800000)), 1800000, "idle after load").catch(() => {});
    results.notes.push(`idle ${Math.round((Date.now() - idleStart) / 1000)} s after the load step finished`);
    entry.idleAfterLoadMs = Date.now() - idleStart;
    save();
    if (process.env.COLLAPSE_FIRST) {
      await step("setup: collapse all groups (workaround)", () => page.click('button[aria-label="Collapse all groups"]'), {
        ready: () => page.waitForFunction(() => !document.querySelector('nav[aria-label="Notes"] button[aria-label^="Collapse "]:not([aria-label="Collapse all groups"])'), null, { timeout: 600000 }),
        extra: async () => ({ rowsAfter: await page.evaluate(() => document.querySelectorAll('nav[aria-label="Notes"] button').length) }),
      });
    }
  } else {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 300000 });
    await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 300000 });
  }

  // ------------------------------------------------------------------------------------------------ sidebar
  if (WANT.has("sidebar")) {
    const before = await page.evaluate(() => document.querySelectorAll('nav[aria-label="Notes"] button').length);
    await step("sidebar: collapse all groups", () => page.click('button[aria-label="Collapse all groups"]'), {
      ready: () => page.waitForFunction(() => !document.querySelector('nav[aria-label="Notes"] button[aria-label^="Collapse "]:not([aria-label="Collapse all groups"])'), null, { timeout: 120000 }),
      extra: async () => ({ rowsBefore: before, rowsAfter: await page.evaluate(() => document.querySelectorAll('nav[aria-label="Notes"] button').length) }),
    });
    await step("sidebar: expand all groups", () => page.click('button[aria-label="Expand all groups"]'), {
      ready: () => page.waitForFunction((n) => document.querySelectorAll('nav[aria-label="Notes"] button').length >= n * 0.9, before, { timeout: 180000 }),
      extra: async () => ({ rowsAfter: await page.evaluate(() => document.querySelectorAll('nav[aria-label="Notes"] button').length) }),
    });
    for (const sort of ["Created: newest", "Updated: oldest", "Custom"]) {
      await step(`sidebar: sort -> ${sort}`, async () => {
        await page.click('button[aria-label^="Sort notes"]');
        await page.click(`[role=menuitemradio]:has-text("${sort}")`);
      }, { ready: () => page.waitForSelector(`button[aria-label="Sort notes: ${sort}"]`, { timeout: 120000 }) });
    }
    const firstGroup = await page.evaluate(() => {
      const b = document.querySelector('nav[aria-label="Notes"] button[aria-label^="Collapse "]:not([aria-label="Collapse all groups"])');
      return b ? b.getAttribute("aria-label").replace(/^Collapse /, "") : null;
    });
    if (firstGroup) {
      await step(`sidebar: collapse one group ("${firstGroup}")`, () => page.click(`nav[aria-label="Notes"] button[aria-label="Collapse ${firstGroup}"]`), { ready: () => page.waitForSelector(`nav[aria-label="Notes"] button[aria-label="Expand ${firstGroup}"]`) });
      await step(`sidebar: expand one group ("${firstGroup}")`, () => page.click(`nav[aria-label="Notes"] button[aria-label="Expand ${firstGroup}"]`), { ready: () => page.waitForSelector(`nav[aria-label="Notes"] button[aria-label="Collapse ${firstGroup}"]`) });
    }
    // Scrolling: how long each frame takes while the list moves.
    await step("sidebar: scroll top -> bottom -> top (40 steps)", async () => {}, {
      extra: async () =>
        page.evaluate(async () => {
          const scroller = [...document.querySelectorAll('nav[aria-label="Notes"] *')].find((e) => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY === "auto");
          if (!scroller) return { scrollNote: "no scroller" };
          const frames = [];
          const steps = 40;
          const max = scroller.scrollHeight - scroller.clientHeight;
          for (let i = 0; i <= steps * 2; i++) {
            const pos = i <= steps ? (i / steps) * max : ((steps * 2 - i) / steps) * max;
            const t = performance.now();
            scroller.scrollTop = pos;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            frames.push(performance.now() - t);
          }
          frames.sort((a, b) => a - b);
          return { scrollHeightPx: scroller.scrollHeight, frameMsP50: Math.round(frames[Math.floor(frames.length / 2)]), frameMsP95: Math.round(frames[Math.floor(frames.length * 0.95)]), frameMsMax: Math.round(frames[frames.length - 1]) };
        }),
    });
    for (const nb of ["Work", "Main"]) {
      await step(`sidebar: switch notebook -> ${nb}`, () => page.click(`button:has-text("${nb}"):not([aria-label^="Actions"])`), {
        ready: () => page.waitForTimeout(50),
        extra: async () => ({ rowsAfter: await page.evaluate(() => document.querySelectorAll('nav[aria-label="Notes"] button').length) }),
      });
    }
  }

  // ------------------------------------------------------------------------------------------------ open + typing on a regular note
  let regular = null;
  if (WANT.has("open") || WANT.has("typing") || WANT.has("autosave") || WANT.has("linkpicker")) {
    regular = await firstRegularTitle();
    results.notes.push(`regular note used: ${regular}`);
  }
  if (WANT.has("open") && regular) {
    // Open a different note first so opening `regular` is a real change.
    const other = await page.evaluate((r) => {
      for (const b of document.querySelectorAll('nav[aria-label="Notes"] button')) {
        const m = /^(.*?)Updated /.exec(b.textContent);
        if (m && m[1] !== r && !m[1].startsWith("EDGE") && m[1].length > 3 && m[1].length < 60) return m[1];
      }
      return null;
    }, regular);
    if (other) {
      await step(`open: regular note A ("${other}")`, () => openNote(other), { timeout: 60000 });
      await step(`open: regular note B ("${regular}")`, () => openNote(regular), { timeout: 60000 });
      await step(`open: back to A`, () => openNote(other), { timeout: 60000 });
      await step(`open: B again`, () => openNote(regular), { timeout: 60000 });
    }
  }
  if (WANT.has("typing") && regular) {
    await step("tab: -> Markdown", () => tab("Markdown"), { ready: () => page.waitForSelector(MD) });
    await typingStep("typing: Markdown tab, regular note", focusMarkdown);
    await step("tab: -> Split", () => tab("Split"), { ready: () => page.waitForSelector(MD) });
    await typingStep("typing: Split tab, regular note", focusMarkdown);
    await step("tab: -> Live", () => tab("Live"), { ready: () => page.waitForSelector(".cm-content") });
    await typingStep("typing: Live tab, regular note", focusLive);
    await step("tab: -> Preview", () => tab("Preview"), { ready: () => page.waitForSelector("h1") });
    await step("tab: -> Split (restore)", () => tab("Split"), { ready: () => page.waitForSelector(MD) });
  }

  // ------------------------------------------------------------------------------------------------ autosave
  if (WANT.has("autosave") && regular) {
    await page.evaluate(() => (window.__fetches.length = 0));
    await step("autosave: edit regular note, wait for save round trip", async () => {
      await tab("Markdown");
      await focusMarkdown();
      await page.keyboard.type("x");
    }, {
      timeout: 60000,
      ready: () => page.waitForFunction(() => window.__fetches.length > 0, null, { timeout: 30000 }),
      extra: async () => ({ saves: await page.evaluate(() => window.__fetches) }),
    });
  }

  // ------------------------------------------------------------------------------------------------ link picker
  if (WANT.has("linkpicker") && regular) {
    await step("tab: -> Markdown (link picker)", () => tab("Markdown"), { ready: () => page.waitForSelector(MD) });
    const lat = [];
    await step("link picker: type '[[' + 'lorem' (title filter over all notes)", async () => {
      await focusMarkdown();
      await page.keyboard.type("\n\n");
      lat.push(...(await typeKeys("[[")));
      lat.push(...(await typeKeys("lorem")));
    }, { timeout: 300000, extra: async () => ({ keyLatencyMs: stats(lat), menuOpen: await page.locator('[role=listbox]').count() }) });
    await page.keyboard.press("Escape");
  }

  // ------------------------------------------------------------------------------------------------ other pages
  if (WANT.has("pages")) {
    await step("page: Home", () => page.click('button[aria-label="Home page"]'), { ready: () => page.waitForTimeout(100), timeout: 120000 });
    const t0 = Date.now();
    await step("page: Settings (full navigation)", async () => {
      await page.goto(BASE + "/settings", { waitUntil: "domcontentloaded", timeout: 300000 });
    }, { timeout: 300000, ready: () => page.waitForSelector("h1, h2", { timeout: 300000 }) });
    await step("page: back to notes (full navigation)", async () => {
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 300000 });
    }, { timeout: 300000, ready: () => page.waitForSelector('nav[aria-label="Notes"]', { timeout: 300000 }) });
    results.notes.push(`pages took ${Date.now() - t0} ms total`);
  }

  // ------------------------------------------------------------------------------------------------ heavy edge-case notes
  if (WANT.has("heavy")) {
    const HEAVY = [
      "EDGE: prose document ~200 KB",
      "EDGE: prose document ~1000 KB",
      "EDGE: prose document ~3000 KB",
      "EDGE: code document ~1000 KB",
      "EDGE: MDX document ~1000 KB",
      "EDGE: one huge line (200,000 chars, no newline)",
      "EDGE: one unbroken token (100,000 chars)",
      "EDGE: 20,000 short lines",
      "EDGE: 5,000 headings (Toc stress)",
      "EDGE: 2,000-row table",
      "EDGE: 60 charts on one note",
      "EDGE: 300 small code blocks",
      "EDGE: one 5 MB-class code block",
      "EDGE: 3,000 task items",
      "EDGE: 200 inline Mark highlights",
      "EDGE: unicode: 20,000 emoji",
      "EDGE: 100-level nested list",
      "EDGE: 300 footnotes",
    ];
    const only = (process.env.HEAVY_ONLY || "").split("|").filter(Boolean);
    for (const title of HEAVY.filter((t) => !only.length || only.some((o) => t.includes(o)))) {
      if (crashed) await recover(`before ${title}`);
      // Start every note on Split, the default, so the first open shows what a user sees first.
      await step(`heavy[${title}] open (Split)`, async () => {
        await tab("Split").catch(() => {});
        await openNote(title);
      }, { timeout: STEP_TIMEOUT });
      const hung = results.steps[results.steps.length - 1];
      if (hung.failed) {
        await recover(`"${title}" hung or crashed`);
        continue;
      }
      await typingStep(`heavy[${title}] typing, Split`, async () => {
        await page.waitForSelector(MD, { timeout: 30000 });
        await focusMarkdown();
      }, "abcdefghij", { timeout: STEP_TIMEOUT });
      for (const [mode, ready, focus] of [
        ["Markdown", MD, focusMarkdown],
        ["Live", ".cm-content", focusLive],
      ]) {
        const sw = await step(`heavy[${title}] switch to ${mode}`, () => tab(mode), { ready: () => page.waitForSelector(ready, { timeout: 120000 }), timeout: STEP_TIMEOUT });
        if (sw.failed) { await recover(`"${title}" ${mode} failed`); break; }
        await typingStep(`heavy[${title}] typing, ${mode}`, focus, "abcdefghij", { timeout: STEP_TIMEOUT });
      }
      const pv = await step(`heavy[${title}] switch to Preview`, () => tab("Preview"), { ready: () => page.waitForSelector("h1", { timeout: 120000 }), timeout: STEP_TIMEOUT });
      if (pv.failed) await recover(`"${title}" preview failed`);
    }
  }

  Object.assign(results, { finishedAt: new Date().toISOString(), consoleErrorsTotal: consoleErrors.length, finalMetrics: await cdpMetrics().catch(() => null) });
  save();
  // Closing a browser holding a page of hundreds of thousands of nodes can take minutes; the results are already saved.
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  log("done");
  process.exit(0);
})().catch(async (error) => {
  results.fatal = String(error.stack || error);
  save();
  console.error(error);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
