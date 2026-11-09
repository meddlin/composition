import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NoteMarkdown } from "@/components/notes/NoteMarkdown";
import "./preview.css";
import SAMPLE from "./sample-note.md?raw";

/**
 * The page a native shell would host. The shell talks to it in two directions and only these:
 *   shell -> page   CoreWebView2.PostWebMessageAsJson({ type: "render", body, theme })   (also window.renderNote for the spike)
 *   page  -> shell  window.chrome.webview.postMessage({ type: "rendered", ms, height })
 * No note, database or file access lives here: the shell owns all data and sends the text.
 */
type Host = { addEventListener(type: "message", h: (e: { data: unknown }) => void): void; postMessage(m: unknown): void };
const host = (window as unknown as { chrome?: { webview?: Host } }).chrome?.webview;
const NO_PLUGINS: never[] = [];

function App() {
  const [body, setBody] = useState(SAMPLE);
  useEffect(() => {
    const onMessage = (data: unknown) => {
      const m = data as { type?: string; body?: string; theme?: string } | null;
      if (m?.type !== "render" || typeof m.body !== "string") return;
      if (m.theme) document.documentElement.dataset.theme = m.theme;
      setBody(m.body);
    };
    host?.addEventListener("message", (e) => onMessage(e.data));
    (window as unknown as { renderNote: (b: string, t?: string) => void }).renderNote = (b, t) => onMessage({ type: "render", body: b, theme: t });
  }, []);
  useEffect(() => {
    const t0 = performance.now();
    const id = requestAnimationFrame(() =>
      host?.postMessage({ type: "rendered", ms: Math.round(performance.now() - t0), height: document.documentElement.scrollHeight }),
    );
    return () => cancelAnimationFrame(id);
  }, [body]);
  return (
    <article className="prose prose-neutral dark:prose-invert mx-auto max-w-3xl p-6">
      <NoteMarkdown body={body} rehypePlugins={NO_PLUGINS} />
    </article>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
