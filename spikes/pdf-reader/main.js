// Spike A (docs/pdf-markup-plan.md): pdf.js inside Electron under the desktop app's real scheme and CSP, with a streaming Range-serving handler.
// Not the app's code: the scheme privileges and CSP string are copied from apps/desktop/src/main/protocol.ts.
const { app, BrowserWindow, protocol } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const PDF = process.env.SPIKE_PDF;
const JPX = process.env.SPIKE_JPX;
const WASM = process.env.CSP_WASM === "1";
const PDFJS_ROOT = path.join(__dirname, "node_modules", "pdfjs-dist");
const WEB_ROOT = path.join(__dirname, "web");

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${WASM ? " 'wasm-unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-src https://www.youtube-nocookie.com app://drawio",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const MIME = {
  ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript",
  ".wasm": "application/wasm", ".pdf": "application/pdf", ".json": "application/json",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const stats = { requests: 0, ranged: 0, unranged: 0, requestedBytes: 0, pdfRequests: [] };

function safeJoin(root, rel) {
  const full = path.join(root, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

function servePdf(file, request) {
  const size = fs.statSync(file).size;
  const base = { "content-type": "application/pdf", "accept-ranges": "bytes", "x-content-type-options": "nosniff" };
  stats.requests += 1;
  const header = request.headers.get("range");
  if (!header) {
    stats.unranged += 1;
    stats.requestedBytes += size;
    stats.pdfRequests.push({ range: null, bytes: size });
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...base, "content-length": String(size) } });
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (m[1] === "" && m[2] === "")) return new Response("Bad range", { status: 416 });
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size) return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}` } });
  stats.ranged += 1;
  stats.requestedBytes += end - start + 1;
  stats.pdfRequests.push({ range: `${start}-${end}`, bytes: end - start + 1 });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...base, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` },
  });
}

function registerHandler() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/documents/")) {
      const name = decodeURIComponent(url.pathname.slice("/documents/".length));
      const file = name === "jpx.pdf" ? JPX : name === "textbook.pdf" ? PDF : null;
      return file ? servePdf(file, request) : new Response("Not found", { status: 404 });
    }
    const [root, rel] = url.pathname.startsWith("/pdfjs/")
      ? [PDFJS_ROOT, url.pathname.slice("/pdfjs/".length)]
      : [WEB_ROOT, url.pathname === "/" ? "index.html" : url.pathname.slice(1)];
    const file = safeJoin(root, decodeURIComponent(rel));
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Not found", { status: 404 });
    return new Response(await fs.promises.readFile(file), {
      headers: {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
        "content-security-policy": CSP,
        "x-content-type-options": "nosniff",
      },
    });
  });
}

const metrics = () =>
  app.getAppMetrics()
    .filter((m) => ["Tab", "Renderer", "Utility", "GPU"].includes(m.type))
    .map((m) => `${m.type}${m.name ? `(${m.name})` : ""}=${Math.round(m.memory.workingSetSize / 1024)}MB`)
    .join(" ");

app.whenReady().then(async () => {
  registerHandler();
  const win = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { backgroundThrottling: false } });
  const messages = [];
  win.webContents.on("console-message", (...args) => {
    const d = args[0];
    messages.push(d && d.message !== undefined ? `[${d.level}] ${d.message}` : `[${args[1]}] ${args[2]}`);
  });
  await win.loadURL(`app://composition/index.html${process.env.SPIKE_QUERY ?? ""}`);

  const phases = ["open", "firstPage", "outline", "jump", "seq100", "text600", "wasm", "jpx"];
  const tag = (process.env.SPIKE_QUERY ?? "").replace(/[^a-z0-9]+/gi, "-");
  const results = { variant: `${WASM ? "csp+wasm-unsafe-eval" : "real-csp"}${tag}`, csp: CSP, electron: process.versions.electron, chrome: process.versions.chrome };
  for (const name of phases) {
    const before = stats.requestedBytes;
    const r = await win.webContents.executeJavaScript(`window.__phase(${JSON.stringify(name)})`, true);
    r.rssAfter = metrics();
    r.pdfBytesRequestedDuringPhase = stats.requestedBytes - before;
    results[name] = r;
    console.log(`\n== ${name}`, JSON.stringify(r));
  }
  results.stats = { ...stats, pdfRequests: stats.pdfRequests.length, sampleRequests: stats.pdfRequests.slice(0, 6) };
  results.consoleMessages = messages;
  console.log("\n== totals", JSON.stringify(results.stats));
  console.log("\n== console", messages.length, "messages");
  for (const m of messages.slice(0, 25)) console.log("  ", m.slice(0, 260));
  fs.writeFileSync(path.join(__dirname, `results-${results.variant}.json`), JSON.stringify(results, null, 2));
  app.quit();
});
