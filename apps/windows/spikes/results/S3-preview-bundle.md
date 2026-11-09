# S3: the web app's real note preview as a standalone page

**Result: it builds untouched and renders in Chromium. Not tried in WebView2.**

`preview/` imports `NoteMarkdown` and the ten MDX components **straight from `apps/web/src`** (nothing there is edited) and builds them with
apps/web's own Vite 8 in about 3 seconds. Three small adaptations, all in this folder: the one module the desktop build already swaps (`imageUrl`) is replaced
by a version that points at a WebView2 virtual host (`https://composition.local/app_data/<name>`); Tailwind runs through PostCSS because apps/web has that flavour, not the Vite plugin;
and a symlink to apps/web's `node_modules` (made by `build.sh`, ignored by git) lets Tailwind find its typography plugin. `NoteMarkdown` imports nothing from `next/*`.

| Measurement | Value |
|---|---|
| JavaScript | 1,097,945 bytes (about 320 KB gzipped); 2,842 modules |
| CSS | 123,010 bytes (about 19 KB gzipped) |
| Build time | about 3 s |

What a check in the Browser pane (Chromium, not WebView2) showed with a note that uses every component: Info, Warning and Mark drawn and tinted by the theme; the Toc; a Recharts line chart;
tables, a code block, task items and the footnote list; the YouTube iframe pointing at `youtube-nocookie.com`; both stored images resolving to the virtual-host URL and showing their
"not found" text because no file is there. The page re-rendered from a message with a different colour scheme (`data-theme="forest"`). **Not looked at:** the `<Repo>` card, an actual stored image, `<Drawio>`'s editor.
**Not measured:** render time (the pane was hidden, so `requestAnimationFrame` never fired), memory, anything inside WebView2.

What the page does **not** include, because it is not in `NoteMarkdown`: the highlight menu and the Drawio edit button (in `NotePane`), the note-link click handling (`NoteAnchor` takes a context from the pane), find in a note, the heading rail. Each is a bridge message or
a native feature the shell must supply. `<YouTube>` still needs the network.

The contract the shell would use: shell to page, `PostWebMessageAsJson({ type: "render", body, theme })`; page to shell, `{ type: "rendered", ms, height }`. The shell strips the frontmatter (the web app does that in `NotePane`).
A Windows build would need Node and apps/web's dependencies in CI to produce this bundle, as the desktop build does today.
