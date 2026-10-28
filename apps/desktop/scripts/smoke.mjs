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
import http from "node:http";
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
const { PANELS_METHODS } = await importTypeScript(path.resolve(desktopDir, "../web/src/lib/composition/panelsApi.ts"));
const { UPDATE_METHODS } = await importTypeScript(path.resolve(desktopDir, "../web/src/lib/composition/updatesApi.ts"));
const { ASSISTANT_METHODS } = await importTypeScript(path.resolve(desktopDir, "../web/src/lib/composition/assistantApi.ts"));
const { WINDOW_METHODS } = await importTypeScript(path.resolve(desktopDir, "../web/src/lib/composition/windowApi.ts"));
const expectedBridge = [
  ...API_METHODS,
  ...ATTACHMENT_METHODS,
  ...BACKUP_METHODS,
  ...PANELS_METHODS,
  ...UPDATE_METHODS,
  ...WINDOW_METHODS,
  ...ASSISTANT_METHODS,
  "onUpdateState",
  "onAppearance",
  "onPopoutClosed",
  "onAssistantEvent",
  "initial",
  "platform",
].sort();

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A stand-in Ollama on a free local port, for the AI helper's settings: one chat model, one embedding model (which
// cannot chat) and one cloud model (which the helper must hide). `requests` records what it was asked.
function startFakeOllama() {
  const requests = [];
  const stats = { aborted: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (piece) => (body += piece));
    req.on("end", () => {
      requests.push(`${req.method} ${req.url}`);
      res.setHeader("content-type", "application/json");
      if (req.method === "GET" && req.url === "/api/tags") {
        res.end(
          JSON.stringify({
            models: [
              { name: "smoke-chat:latest", details: { parameter_size: "1B" } },
              { name: "smoke-embed:latest", details: { parameter_size: "100M" } },
              { name: "smoke-cloud:cloud", remote_host: "https://ollama.com:443", remote_model: "smoke-cloud", details: {} },
            ],
          }),
        );
      } else if (req.method === "POST" && req.url === "/api/show") {
        const { model } = JSON.parse(body);
        res.end(
          JSON.stringify({
            capabilities: model === "smoke-embed:latest" ? ["embedding"] : ["completion"],
            model_info: { "general.architecture": "smoke", "smoke.context_length": 4096 },
          }),
        );
      } else if (req.method === "POST" && req.url === "/api/chat") {
        // "slow" keeps generating until the client goes away; anything else answers at once.
        const { messages } = JSON.parse(body);
        const slow = messages.some((m) => String(m.content).includes("slow"));
        res.setHeader("content-type", "application/x-ndjson");
        const line = (content, done = false) =>
          JSON.stringify({ message: { role: "assistant", content }, done, ...(done && { prompt_eval_count: 7, eval_count: 2 }) }) + "\n";
        res.on("close", () => {
          if (!res.writableEnded) stats.aborted += 1;
        });
        if (slow) {
          res.write(line("tick "));
          const timer = setInterval(() => res.write(line("tick ")), 100);
          res.on("close", () => clearInterval(timer));
        } else {
          res.write(line("Hello "));
          res.end(line("there", false) + line("", true));
        }
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, stats })),
  );
}

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
// Typed into a pop-out just before the app quits, and looked for after the relaunch.
let quitText = "";
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
    "the bridge exposes only the API (+ attachments, backup, panels, updates, initial, platform)",
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

  // ---- AI helper (Settings). The server is a stand-in on a free local port; nothing leaves this machine.
  const ollama = await startFakeOllama();
  const decoy = await startFakeOllama();
  await page.getByRole("tab", { name: "AI Configuration" }).click();
  const helper = page.locator('[data-slot="card"]').filter({ has: page.getByRole("heading", { name: "AI helper" }) });
  await helper.waitFor();
  await helper.getByLabel("Server address").fill(ollama.url);
  await helper.getByRole("button", { name: "Save", exact: true }).click();
  await helper.getByRole("status").filter({ hasText: "Found" }).waitFor();
  const helperStatus = (await helper.getByRole("status").textContent()) ?? "";
  check(
    "the AI helper saves its server over IPC and lists only the models that can chat",
    helperStatus.includes(`Found 1 model on ${ollama.url}: smoke-chat:latest (1B)`),
    helperStatus,
  );
  check("and says how many cloud models it left out", ((await helper.textContent()) ?? "").includes("1 model that runs on ollama.com was left out"));
  const desktopSettings = JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf-8"));
  check(
    "the server is stored in the desktop app's own settings file",
    desktopSettings.assistant?.serverUrl === ollama.url && desktopSettings.assistant?.contextTokens === 8192,
    JSON.stringify(desktopSettings.assistant),
  );
  const steered = await page.evaluate((url) => window.composition.listAssistantModels(url), decoy.url);
  check(
    "the page can't point the model list at another address",
    steered.serverUrl === ollama.url && decoy.requests.length === 0,
    `${steered.serverUrl}; the other server saw ${decoy.requests.length} requests`,
  );
  const refusedAddress = await page.evaluate(() => window.composition.saveAssistantSettings({ serverUrl: "ftp://nas", contextTokens: 8192 }));
  check("an address that cannot work is refused with a reason", typeof refusedAddress.error === "string" && !refusedAddress.settings, refusedAddress.error);
  const malformed = await page.evaluate(() =>
    window.composition.saveAssistantSettings({ serverUrl: 5, contextTokens: 8192 }).then(
      () => "accepted",
      () => "rejected",
    ),
  );
  check("arguments of the wrong type are rejected at the IPC boundary", malformed === "rejected");
  check(
    "after those refusals the saved server is still the good one",
    (await page.evaluate(() => window.composition.loadSettings())).assistant.serverUrl === ollama.url,
  );

  // ---- AI helper chat: the main process makes the request, and pushes each event to this window.
  const turn = (text, abortAfterFirst = false) =>
    page.evaluate(
      async ({ text, abortAfterFirst }) => {
        const id = `smoke-${Math.random().toString(36).slice(2)}`;
        const events = [];
        const stop = window.composition.onAssistantEvent((m) => {
          if (m.requestId !== id) return;
          events.push(m.event);
          if (abortAfterFirst && events.length === 1) void window.composition.assistantAbort(id);
        });
        const call = window.composition.assistantChat(id, { model: "smoke-chat:latest", messages: [{ role: "user", content: text }], numCtx: 8192 });
        const outcome = await call.then(() => "resolved", (e) => `rejected: ${e.message}`);
        // The call's answer and the events travel separately, so an event can still be on its way when the call returns
        // (the page waits for the one that ends the turn in the same way).
        for (const deadline = Date.now() + 1000; !events.some((e) => e.type === "done" || e.type === "error") && Date.now() < deadline; ) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        stop();
        return { events, outcome };
      },
      { text, abortAfterFirst },
    );
  const answered = await turn("hello");
  check(
    "a chat turn streams the reply to the window over IPC, ending with the token counts and done",
    answered.events.filter((e) => e.type === "delta").map((e) => e.text).join("") === "Hello there" &&
      JSON.stringify(answered.events.slice(-2)) === JSON.stringify([{ type: "usage", promptTokens: 7, outputTokens: 2 }, { type: "done" }]),
    JSON.stringify(answered.events),
  );
  check("the request went to the saved server, after checking the model with /api/show", ollama.requests.slice(-2).join(" then ") === "POST /api/show then POST /api/chat", ollama.requests.slice(-3).join(" then "));
  const stopped = await turn("slow", true);
  await waitFor(async () => ollama.stats.aborted === 1);
  check(
    "stopping a turn ends it with an aborted event and drops the connection to Ollama",
    stopped.events[stopped.events.length - 1]?.kind === "aborted" && stopped.outcome === "resolved" && ollama.stats.aborted === 1,
    JSON.stringify(stopped.events.slice(-1)),
  );
  const cloud = await page.evaluate(() =>
    window.composition
      .assistantChat("smoke-cloud", { model: "gpt-oss:20b:cloud", messages: [{ role: "user", content: "hi" }], numCtx: 8192 })
      .then(() => "accepted", () => "rejected"),
  );
  check("a cloud model is refused at the IPC boundary", cloud === "rejected" && !ollama.requests.some((r) => r.includes("cloud")));
  const sneaky = await page.evaluate(
    () => window.composition.assistantChat("smoke-url", { model: "smoke-chat:latest", messages: [{ role: "user", content: "hi" }], numCtx: 8192, baseUrl: "http://127.0.0.1:1" }, "http://127.0.0.1:1").then(() => "ok", () => "rejected"),
  );
  check("an address sent with the request is ignored", sneaky === "ok" && decoy.requests.length === 0, `${sneaky}; the other server saw ${decoy.requests.length} requests`);

  // ---- AI helper, as a panel beside a note: ask a question, read the answer in the panel, make a note from it.
  await page.getByRole("link", { name: /Back to notes/ }).click();
  const notePane = page.getByRole("region", { name: "Smoke note" });
  await notePane.getByRole("button", { name: "AI helper" }).click();
  const helperPanel = page.getByRole("region", { name: "AI helper" });
  await helperPanel.getByRole("option", { name: /smoke-chat:latest/ }).waitFor({ state: "attached" });
  check(
    "the AI helper button opens a panel of its own, not a dock inside the note",
    (await helperPanel.count()) === 1 && (await notePane.getByRole("complementary").count()) === 0,
  );
  check(
    "which is about the note it was opened from, and lists the server's chat models",
    (await helperPanel.getByText("Smoke note").count()) === 1 && (await helperPanel.getByText("Runs on this computer").count()) === 1,
  );
  check("and has the cursor in its question box", await helperPanel.getByLabel("Ask about this note").evaluate((el) => el === document.activeElement));
  const noteBefore = await page.evaluate(() => window.composition.loadWorkspace().then((w) => w.notes.find((n) => n.title === "Smoke note").content));
  // Text selected in the note is offered to the helper as the user moves into its panel.
  await notePane.getByLabel("Markdown editor").evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 5);
  });
  await helperPanel.getByLabel("Ask about this note").focus();
  check("text selected in the note is offered to the helper as a selection", (await helperPanel.getByText("Selection (5 characters)").count()) === 1);
  await helperPanel.getByLabel("Ask about this note").fill("hello");
  await helperPanel.getByLabel("Ask about this note").press("Enter");
  await helperPanel.getByText("Hello there").waitFor();
  check("a question typed in the panel is answered from the saved server, as it streams", ollama.requests.at(-1) === "POST /api/chat");
  check("and the question went with the selection", (await helperPanel.getByText("with a selection (5 characters)").count()) === 1);
  await page.screenshot({ path: path.join(out, "3a-ai-panel.png") });
  await helperPanel.getByRole("button", { name: "New note from this" }).click();
  await page.getByRole("region", { name: "Hello there" }).waitFor();
  const afterAnswer = await page.evaluate(() => window.composition.loadWorkspace());
  check(
    "'New note from this' makes a separate note holding the answer",
    afterAnswer.notes.some((n) => n.title === "Hello there" && n.content.includes("Hello there")),
    afterAnswer.notes.map((n) => n.title).join(","),
  );
  check("and leaves the note the answer was about unchanged", afterAnswer.notes.find((n) => n.title === "Smoke note").content === noteBefore);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor();

  // ---- The workspace is kept while Settings is open: coming back, the open panels and the AI helper's chat are still there.
  await page.getByRole("link", { name: /Back to notes/ }).click();
  await page.waitForSelector('nav[aria-label="Notes"]');
  await page.getByRole("region", { name: "Smoke note" }).waitFor({ timeout: 5_000 }).catch(() => {});
  check(
    "the open panels survive a visit to Settings",
    (await page.getByRole("region", { name: "Smoke note" }).count()) === 1 && (await page.getByRole("region", { name: "Hello there" }).count()) === 1,
  );
  const keptNotePane = page.getByRole("region", { name: "Smoke note" });
  check(
    "and so does the AI helper's panel, with its chat about the note",
    (await helperPanel.count()) === 1 && (await helperPanel.getByText("Hello there").count()) > 0,
  );
  // Closing the panel does not lose the chat: it belongs to the note, and comes back with the next panel opened for it.
  await helperPanel.getByRole("button", { name: "Panel options" }).click();
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  check("the AI helper's panel closes from its menu", (await page.getByRole("region", { name: "AI helper" }).count()) === 0);
  await keptNotePane.getByRole("button", { name: "AI helper" }).click();
  await helperPanel.waitFor();
  check("and opening it again brings the chat back", (await helperPanel.getByText("Hello there").count()) > 0);
  await helperPanel.getByRole("button", { name: "Panel options" }).click();
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();

  // ---- The panel grid: a new panel is added beside, filled with a notes browser, and a deleted note's panel stays.
  await keptNotePane.getByRole("button", { name: "New panel" }).click();
  await page.getByRole("region", { name: "Empty panel" }).waitFor();
  await page.getByRole("region", { name: "Empty panel" }).getByRole("button", { name: "Notes browser" }).click();
  const browserPanel = page.getByRole("region", { name: "Notes browser" });
  await browserPanel.waitFor();
  check("+ adds a panel, which can be turned into a notes browser", (await browserPanel.getByRole("navigation", { name: "Notes" }).count()) === 1);
  check("panels have a divider between each pair", (await page.getByRole("separator", { name: /^Resize panels/ }).count()) === 2);
  await page.screenshot({ path: path.join(out, "3b-panels.png") });

  await browserPanel.getByRole("navigation", { name: "Notes" }).getByText("Smoke note").first().click();
  check(
    "picking a note in a notes browser shows it in a note panel, not in the browser",
    (await page.getByRole("region", { name: "Smoke note" }).count()) === 1 && (await browserPanel.count()) === 1,
  );

  await page.getByRole("navigation", { name: "Notes" }).first().getByRole("button", { name: "Delete Hello there" }).click({ force: true });
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  const deletedPanel = page.getByRole("region", { name: "Hello there" });
  await deletedPanel.locator("header span.line-through").waitFor({ timeout: 5_000 }).catch(() => {});
  check(
    "a note deleted while it is open stays in its panel, struck through and read-only",
    (await deletedPanel.locator("header span.line-through").count()) === 1 &&
      (await deletedPanel.getByLabel("Markdown editor").evaluate((el) => el.readOnly)),
  );
  await page.waitForTimeout(300);

  // ---- Panel commands: their keys and the command palette. Playwright's key presses reach the page, not the native
  // menu, which is why these are page handlers (and why a native-menu clash can only be seen by hand).
  const chord = (key) => `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+${key}`;
  const settled = (fn) => waitFor(fn, { timeout: 5_000 }).then(() => true, () => false);
  // The panel's own section: an editor sits inside a plain, unnamed one of its own.
  const panelWithCursor = (where) =>
    where.evaluate(() => document.activeElement?.closest("section[data-panel-id]")?.getAttribute("aria-label") ?? "");
  const panelCount = (where) => where.locator("section[data-panel-id]").count();
  const palette = (where) => where.getByRole("dialog", { name: "Command palette" });

  await page.getByRole("region", { name: "Smoke note" }).getByLabel("Markdown editor").click();
  await page.keyboard.press(chord("P"));
  await palette(page).waitFor({ timeout: 5_000 }).catch(() => {});
  check(
    "Cmd/Ctrl+Shift+P opens the command palette from inside a note, with the cursor in its search box and every panel command listed",
    (await palette(page).count()) === 1 &&
      (await page.getByRole("combobox", { name: "Search commands" }).evaluate((el) => el === document.activeElement)) &&
      (await palette(page).getByRole("option").count()) === 7,
  );
  await page.keyboard.type("next");
  await page.keyboard.press("Enter");
  check(
    "a command run from the palette closes it and leaves the cursor in the panel it moved to, not the one it was opened from",
    (await settled(async () => (await palette(page).count()) === 0 && (await panelWithCursor(page)) === "Notes browser")),
    await panelWithCursor(page),
  );

  await page.keyboard.press(chord("BracketRight"));
  await settled(async () => (await panelWithCursor(page)) === "Hello there");
  const afterNext = await panelWithCursor(page);
  await page.keyboard.press(chord("BracketRight"));
  await settled(async () => (await panelWithCursor(page)) === "Smoke note");
  const afterWrap = await panelWithCursor(page);
  await page.keyboard.press(chord("BracketLeft"));
  await settled(async () => (await panelWithCursor(page)) === "Hello there");
  const afterPrevious = await panelWithCursor(page);
  check(
    "Cmd/Ctrl+Shift+] and [ move the cursor through the panels in layout order, wrapping round",
    afterNext === "Hello there" && afterWrap === "Smoke note" && afterPrevious === "Hello there",
    `${afterNext} / ${afterWrap} / ${afterPrevious}`,
  );

  await page.getByRole("region", { name: "Smoke note" }).getByLabel("Markdown editor").click();
  const panelsBefore = await panelCount(page);
  await page.keyboard.press(chord("Backslash"));
  const split = await settled(async () => (await panelCount(page)) === panelsBefore + 1 && (await panelWithCursor(page)) === "Empty panel");
  check("Cmd/Ctrl+Shift+\\ splits right from inside the editor, and the new panel takes the cursor", split, await panelWithCursor(page));
  await page.keyboard.press(chord("W"));
  const closed = await settled(async () => (await panelCount(page)) === panelsBefore && (await panelWithCursor(page)) === "Smoke note");
  check("Cmd/Ctrl+Shift+W closes it again, and the cursor goes back to the panel used before", closed, await panelWithCursor(page));
  await page.waitForTimeout(300);

  // ---- Pop-outs: a panel in a window of its own, over the one workspace the main window holds.
  const popoutPage = () => app.windows().find((window) => window.url().includes("/popout/") && !window.isClosed());
  const opened = app.waitForEvent("window");
  await page.getByRole("region", { name: "Smoke note" }).getByRole("button", { name: "Panel options" }).click();
  await page.getByRole("menuitem", { name: "Move to new window" }).click();
  const popout = await opened;
  await popout.getByRole("region", { name: "Smoke note" }).waitFor({ timeout: 15_000 });
  check(
    "Move to new window opens a window with that panel, which leaves the main window",
    /\/popout\/\?w=w1$/.test(popout.url()) && (await page.getByRole("region", { name: "Smoke note" }).count()) === 0,
    popout.url(),
  );
  const link = await popout.evaluate(() => ({
    opener: typeof window.opener,
    store: typeof window.opener?.__workspace?.store?.getSnapshot,
    bridge: typeof window.composition,
    require: typeof window.require,
    process: typeof window.process,
  }));
  check("the pop-out reaches the main window's workspace through window.opener", link.opener === "object" && link.store === "function", JSON.stringify(link));
  check("and is as isolated as the main window: the bridge, and no Node", link.bridge === "object" && link.require === "undefined" && link.process === "undefined");

  const popoutToken = `popout${Date.now()}`;
  await popout.getByLabel("Markdown editor").fill(`${popoutToken} typed in the pop-out`);
  await waitFor(async () => (await page.evaluate(() => window.composition.loadWorkspace())).notes.some((n) => n.content.includes(popoutToken)));
  check("text typed in the pop-out is saved to the database", true);
  check(
    "and is the main window's own copy of the note",
    await page.evaluate((token) => window.__workspace.store.getSnapshot().notes.some((n) => n.content.includes(token)), popoutToken),
  );

  await popout.getByRole("button", { name: "Panel options" }).click();
  await popout.getByRole("menu").waitFor({ timeout: 5_000 }).catch(() => {});
  const menuOpened = (await popout.getByRole("menu").count()) === 1;
  // Radix starts listening for an outside click on the next tick after a menu opens; a person is slower than that.
  await popout.waitForTimeout(300);
  await popout.mouse.click(5, 300);
  await popout.getByRole("menu").waitFor({ state: "detached", timeout: 3_000 }).catch(() => {});
  const menusAfter = await popout.getByRole("menu").count();
  check("a menu in the pop-out closes on a click outside it", menuOpened && menusAfter === 0, `opened: ${menuOpened}, still there after the click: ${menusAfter}`);

  // The AI helper in a pop-out: a panel beside the note there, holding the chat the workspace keeps for the note.
  await popout.getByRole("region", { name: "Smoke note" }).getByRole("button", { name: "AI helper" }).click();
  const popoutHelper = popout.getByRole("region", { name: "AI helper" });
  await popoutHelper.waitFor({ timeout: 10_000 });
  await popoutHelper.getByRole("option", { name: /smoke-chat:latest/ }).waitFor({ state: "attached" });
  check(
    "the AI helper opens in the pop-out as a panel about its note, with the chat the main window's workspace holds",
    (await popoutHelper.getByText("Smoke note").count()) === 1 && (await popoutHelper.getByText("Hello there").count()) > 0,
  );

  // The same keys and palette work in the pop-out, on its own panels (the Smoke note and the AI helper beside it).
  await popout.getByLabel("Markdown editor").click();
  await popout.keyboard.press(chord("P"));
  await palette(popout).waitFor({ timeout: 5_000 }).catch(() => {});
  const popoutPaletteOpened = (await palette(popout).count()) === 1;
  await popout.keyboard.type("next");
  await popout.keyboard.press("Enter");
  const popoutMoved = await settled(async () => (await palette(popout).count()) === 0 && (await panelWithCursor(popout)) === "AI helper");
  await popout.keyboard.press(chord("BracketLeft"));
  const popoutBack = await settled(async () => (await panelWithCursor(popout)) === "Smoke note");
  check(
    "the command palette and the panel keys work in a pop-out, on that window's own panels",
    popoutPaletteOpened && popoutMoved && popoutBack,
    `${popoutPaletteOpened} / ${popoutMoved} / ${popoutBack}`,
  );

  // A second pop-out, sent back to the main window: its real window closes.
  const secondOpened = app.waitForEvent("window");
  await page.getByRole("region", { name: "Notes browser" }).getByRole("button", { name: "Panel options" }).click();
  await page.getByRole("menuitem", { name: "Move to new window" }).click();
  const second = await secondOpened;
  await second.getByRole("region", { name: "Notes browser" }).waitFor({ timeout: 15_000 });
  const secondClosed = second.waitForEvent("close");
  await second.getByRole("button", { name: "Panel options" }).click();
  await second.getByRole("menuitem", { name: "Move back to main window" }).click();
  await secondClosed;
  check(
    "Move back to main window returns the panel and closes the pop-out",
    (await page.getByRole("region", { name: "Notes browser" }).count()) === 1 && app.windows().filter((w) => !w.isClosed()).length === 2,
  );

  // Reloading the main window loses the workspace the pop-out shows, so it closes; the saved layout brings it back.
  await page.reload();
  await page.waitForSelector('nav[aria-label="Notes"]');
  await waitFor(async () => popout.isClosed());
  check("reloading the main window closes the pop-out", popout.isClosed());
  const reopened = await waitFor(async () => {
    const window = popoutPage();
    return window && (await window.getByRole("region", { name: "Smoke note" }).count()) === 1 ? window : null;
  }, { timeout: 30_000 });
  check("and the saved layout opens it again, with its panel", Boolean(reopened));
  check(
    "which shows the text typed in it before the reload",
    (await reopened.getByLabel("Markdown editor").inputValue()).includes(popoutToken),
  );

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  check("a visit to Settings leaves the pop-out open", Boolean(popoutPage()) && (await popoutPage().getByRole("region", { name: "Smoke note" }).count()) === 1);
  check("Settings has a switch for the duplicate-note warning", (await page.getByRole("checkbox", { name: /Warn when a note is opened in more than one panel/ }).count()) === 1);

  // ---- Updates (Settings). Nothing here reaches the network: the first automatic check is 30 s
  // after launch, and the toggle is only ever switched off.
  await page.getByRole("heading", { name: "Updates" }).waitFor();
  const updateState = await page.evaluate(() => window.composition.getUpdateState());
  const appVersion = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf-8")).version;
  check(
    "updates are reported as supported only in the packaged app, at this version",
    updateState.supported === Boolean(packaged) && updateState.currentVersion === appVersion && updateState.phase === "idle",
    JSON.stringify(updateState),
  );
  check("automatic checking starts on", updateState.autoCheck === true);
  check("pre-release versions start off", updateState.allowPrerelease === false);
  // The update toggles are only on the page in the installed app ("Updates only work in the installed app, not in a development run").
  if (packaged) {
    // click(), not uncheck(): the box is driven by the main process's state, so it flips a moment after the click.
    await page.getByLabel("Check for updates automatically").click();
    const updatePrefsFile = path.join(userData, "updates.json");
    await waitFor(async () => fs.existsSync(updatePrefsFile));
    check("switching it off is stored in the updater's own file", JSON.parse(fs.readFileSync(updatePrefsFile, "utf-8")).autoCheck === false);
    check("and the pre-release choice is kept beside it, still off", JSON.parse(fs.readFileSync(updatePrefsFile, "utf-8")).allowPrerelease === false);
    const settingsFile = path.join(userData, "settings.json"); // only exists once something has been saved to it
    check("and not in the shared settings file", !fs.existsSync(settingsFile) || !("autoCheck" in JSON.parse(fs.readFileSync(settingsFile, "utf-8"))));
    check("the page can't make an update install that isn't ready", (await page.evaluate(() => window.composition.installUpdate())).phase === "idle");
  } else {
    console.log("SKIP  the update toggles  (development build: they are not shown)");
  }

  await page.getByRole("tab", { name: "Styling" }).click();
  await page.getByLabel("Light", { exact: true }).check();
  await waitFor(async () => (await page.evaluate(() => window.composition.loadSettings())).theme === "light");
  check("changing the theme applies it immediately", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
  await waitFor(async () => (await popoutPage().evaluate(() => document.documentElement.dataset.theme)) === "light").catch(() => {});
  check("a pop-out follows the color scheme chosen in Settings", (await popoutPage().evaluate(() => document.documentElement.dataset.theme)) === "light");
  check("the theme is stored in the app's own settings file", fs.existsSync(path.join(userData, "settings.json")) && JSON.parse(fs.readFileSync(path.join(userData, "settings.json"), "utf-8")).theme === "light");
  check("the web app's settings file was not touched", !fs.existsSync(path.join(home, ".composition-web", "settings.json")));
  await page.screenshot({ path: path.join(out, "4-settings-light.png") });
  await page.getByRole("tab", { name: "General" }).click();

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

  // ---- Quitting: what was typed in the last moments is not lost, and the pop-out is remembered where it was put.
  await app.evaluate(({ BrowserWindow }) => {
    const popout = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("/popout/"));
    popout.setBounds({ x: 120, y: 140, width: 720, height: 520 });
  });
  await sleep(700); // the main process writes a window's place a moment after it stops moving
  quitText = `quit${Date.now()}`;
  await popoutPage().getByLabel("Markdown editor").fill(`${quitText} typed just before quitting`);
  // No wait: the app quits inside the half second the text waits to be autosaved.

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

// ---- Relaunch: the panels come back as they were left, a deleted note's panel included.
const relaunched = await electron.launch({
  executablePath: packaged ?? electronPath,
  args: packaged ? [`--user-data-dir=${userData}`] : [desktopDir, `--user-data-dir=${userData}`],
  env: { ...process.env, HOME: home },
  cwd: "/",
});
try {
  const page = await relaunched.firstWindow();
  await page.waitForSelector('nav[aria-label="Notes"]', { timeout: 30_000 });
  await page.getByRole("region", { name: "Notes browser" }).waitFor({ timeout: 10_000 }).catch(() => {});
  const regions = async (name) => page.getByRole("region", { name }).count();
  check(
    "the main window's panels come back after a relaunch: the notes browser, not the note that is in a pop-out",
    (await regions("Notes browser")) === 1 && (await regions("Smoke note")) === 0,
  );
  check(
    "and the panel of the note that was deleted, still struck through",
    (await page.getByRole("region", { name: "Hello there" }).locator("header span.line-through").count()) === 1,
  );
  check("and their divider", (await page.getByRole("separator", { name: /^Resize panels/ }).count()) === 1);

  const popoutAgain = await waitFor(async () => {
    const window = relaunched.windows().find((w) => w.url().includes("/popout/") && !w.isClosed());
    return window && (await window.getByRole("region", { name: "Smoke note" }).count()) === 1 ? window : null;
  }, { timeout: 30_000 }).catch(() => null);
  check("the pop-out comes back after a relaunch, with its panel", Boolean(popoutAgain));
  check(
    "and the AI helper's panel in it, still about the note",
    Boolean(popoutAgain) &&
      (await popoutAgain.getByRole("region", { name: "AI helper" }).getByText("Smoke note").count()) === 1,
  );
  const placed = await relaunched.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("/popout/"));
    return window?.getBounds();
  });
  check(
    "where the user had put it",
    Boolean(placed) && placed.x === 120 && placed.y === 140 && placed.width === 720 && placed.height === 520,
    JSON.stringify(placed),
  );
  const saved = await page.evaluate(() => window.composition.loadWorkspace());
  check(
    "and what was typed in it a moment before the app quit was saved",
    saved.notes.some((n) => n.content.includes(quitText)),
    quitText,
  );
  await page.screenshot({ path: path.join(out, "6-relaunched.png") });
} catch (error) {
  console.error(error);
  failures.push(`unexpected error after the relaunch: ${error.message}`);
} finally {
  await Promise.race([relaunched.close().catch(() => {}), sleep(15_000)]);
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
