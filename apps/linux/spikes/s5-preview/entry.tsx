// Spike S5: the desktop's own note preview (`NoteMarkdown` and the `mdx/` components) as a standalone page, for a WebKitGTK
// view to load. Nothing here is a copy: it imports the web app's source as it stands and wraps it the way
// MarkdownEditor.tsx wraps it (the `prose preview-text note-pane note-surface` container).
import "@/app/globals.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import rehypeHighlight from "rehype-highlight";
import { all } from "lowlight";
import { NoteMarkdown } from "@/components/notes/NoteMarkdown";
import { NoteLinksProvider } from "@/components/notes/NoteLink";

type State = { body: string };

declare global {
  interface Window {
    composition: { render(body: string): void; setTheme(name: string): void };
    webkit?: { messageHandlers?: Record<string, { postMessage(message: unknown): void }> };
  }
}

// What the desktop loads lazily once a note has a fenced code block, loaded eagerly here so the bundle size is the worst case.
const rehypePlugins = [[rehypeHighlight, { languages: all, detect: false }]] as never;

function post(message: unknown) {
  window.webkit?.messageHandlers?.composition?.postMessage(message);
}

let setState: (s: State) => void = () => {};

function App() {
  const [state, set] = useState<State>({ body: "" });
  setState = set;
  useEffect(() => post({ type: "rendered", headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length }), [state]);
  return (
    <NoteLinksProvider
      value={{
        exists: () => true,
        // The native shell opens the note; the page only says which one was asked for.
        open: (noteId, beside) => post({ type: "open-note", noteId, beside }),
      }}
    >
      <div className="prose preview-text note-pane note-surface max-w-none p-4">
        <NoteMarkdown body={state.body} rehypePlugins={rehypePlugins} />
      </div>
    </NoteLinksProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

window.composition = {
  render: (body) => setState({ body }),
  setTheme: (name) => {
    document.documentElement.dataset.theme = name;
  },
};
post({ type: "ready" });
