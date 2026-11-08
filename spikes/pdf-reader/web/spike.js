import * as pdfjsLib from "/pdfjs/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs";

const violations = [];
document.addEventListener("securitypolicyviolation", (e) =>
  violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: (e.sample || "").slice(0, 60) }),
);

const OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
  isEvalSupported: false,
  enableXfa: false,
};

const t = () => performance.now();
const round = (n) => Math.round(n * 10) / 10;
const heapMB = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
let doc = null;

async function renderPage(d, n, scale) {
  const s = t();
  const page = await d.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  const layer = document.createElement("div");
  document.getElementById("host").append(layer);
  await new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport }).render();
  const spans = layer.querySelectorAll("span").length;
  layer.remove();
  page.cleanup();
  return { ms: s ? t() - s : 0, spans, canvas, ctx };
}

const stats = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return { n: xs.length, avg: round(xs.reduce((a, b) => a + b, 0) / xs.length), p95: round(sorted[Math.floor(sorted.length * 0.95)]), max: round(sorted[sorted.length - 1]) };
};

// pdf.js only uses Range for http(s) URLs (isHttp in pdf.mjs), so on app:// we hand it a transport that does the fetching.
class AppRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  constructor(url, length, initialData) {
    super(length, initialData);
    this.url = url;
    this.fetches = 0;
  }
  requestDataRange(begin, end) {
    this.fetches += 1;
    fetch(this.url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
      .then((r) => r.arrayBuffer())
      .then((buf) => this.onDataRange(begin, new Uint8Array(buf)));
  }
}

const query = new URLSearchParams(location.search);
let transport = null;

const phases = {
  async open() {
    const s = t();
    if (query.get("range") === "1") {
      const url = "/documents/textbook.pdf";
      const first = await fetch(url, { headers: { Range: "bytes=0-65535" } });
      const length = Number(first.headers.get("content-range").split("/")[1]);
      transport = new AppRangeTransport(url, length, new Uint8Array(await first.arrayBuffer()));
      doc = await pdfjsLib.getDocument({
        range: transport,
        length,
        disableAutoFetch: true,
        disableStream: true,
        rangeChunkSize: Number(query.get("chunk") || 65536),
        ...OPTIONS,
      }).promise;
      return { mode: "range-transport", openMs: round(t() - s), numPages: doc.numPages, length };
    }
    doc = await pdfjsLib.getDocument({ url: "/documents/textbook.pdf", ...OPTIONS }).promise;
    return { mode: "url", openMs: round(t() - s), numPages: doc.numPages };
  },
  async firstPage() {
    const r = await renderPage(doc, 1, 1.5);
    return { renderMs: round(r.ms), textSpans: r.spans };
  },
  async outline() {
    const s = t();
    const outline = await doc.getOutline();
    const count = (items) => items.reduce((n, i) => n + 1 + count(i.items || []), 0);
    const labels = await doc.getPageLabels();
    return {
      ms: round(t() - s),
      topLevel: outline.length,
      total: count(outline),
      firstTitles: outline.slice(0, 3).map((i) => i.title),
      labelSample: { p1: labels[0], p8: labels[7], p9: labels[8], p10: labels[9], p600: labels[599] },
    };
  },
  async jump() {
    const out = {};
    for (const n of [300, 450, 600]) out[`page${n}Ms`] = round((await renderPage(doc, n, 1.5)).ms);
    return out;
  },
  async seq100() {
    const times = [];
    for (let n = 100; n < 200; n++) times.push((await renderPage(doc, n, 1.25)).ms);
    return stats(times);
  },
  async text600() {
    const s = t();
    let items = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      items += (await page.getTextContent()).items.length;
      page.cleanup();
    }
    const sample = (await (await doc.getPage(20)).getTextContent()).items.slice(0, 3).map((i) => i.str.slice(0, 50));
    return { allPagesMs: round(t() - s), items, sample };
  },
  async wasm() {
    const out = {};
    try {
      await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      out.emptyModule = "compiled";
    } catch (e) {
      out.emptyModule = `blocked: ${e.message}`.slice(0, 160);
    }
    try {
      const bytes = await (await fetch("/pdfjs/wasm/openjpeg.wasm")).arrayBuffer();
      await WebAssembly.compile(bytes);
      out.openjpeg = "compiled";
    } catch (e) {
      out.openjpeg = `blocked: ${e.message}`.slice(0, 160);
    }
    return out;
  },
  async jpx() {
    const s = t();
    try {
      const d = await pdfjsLib.getDocument({ url: "/documents/jpx.pdf", ...OPTIONS }).promise;
      const r = await renderPage(d, 1, 1);
      const px = r.ctx.getImageData(Math.floor(r.canvas.width / 2), Math.floor(r.canvas.height / 2), 1, 1).data;
      return { rendered: true, ms: round(t() - s), centerPixel: [...px] };
    } catch (e) {
      return { rendered: false, error: String(e && e.message).slice(0, 200) };
    }
  },
};

window.__phase = async (name) => {
  const before = violations.length;
  const r = await phases[name]();
  r.jsHeapMB = heapMB();
  r.cspViolations = violations.slice(before);
  return r;
};
