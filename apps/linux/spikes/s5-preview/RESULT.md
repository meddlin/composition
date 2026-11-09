# S5: the desktop's own preview, as a bundle in WebKitGTK

Run 2026-11-07. Code: `entry.tsx`, `vite.config.mjs`, `build.sh`, `verify-bundle.mjs`, `harness.sh`; the host half is in
`../s3-shell/src/main.rs` (`serve`, the `composition` script-message handler).

**Question.** If the Preview is a web view, can it run the web app's *own* `NoteMarkdown` and `mdx/` components, standalone, so that the
Linux app does not need a third MDX implementation? And does WebKitGTK draw it?

**Answer: yes to both, in the container and with the WebKitGTK sandbox disabled for the run (below).** Nothing in `apps/web` was
changed.

## How it is built

`entry.tsx` imports `NoteMarkdown` and `NoteLinksProvider` from the web app's source, wraps them in the `prose preview-text note-pane
note-surface` container that `MarkdownEditor.tsx` uses, and exposes `window.composition.render(body)` and `.setTheme(name)`. Vite 8 (the
one `apps/web` already has, so no new dependency) builds it to an IIFE:

| | Size |
|---|---|
| `preview.js` | **2.0 MB** raw, **616 KB** gzipped (everything: React 19, react-markdown, remark and rehype, recharts, lucide, and highlight.js with **all** languages, which the web app loads lazily) |
| `preview.css` | 123 KB (the web app's `globals.css` through its own Tailwind v4 pipeline, so the five colour schemes come with it) |

Build settings that mattered: `resolve.extensions` puts `.desktop.ts` first, as `next.config.ts` does for the desktop export, so
`imageUrl.desktop.ts` wins and images are `app://composition/app_data/<name>`. The shell registers an `app` URI scheme on its
`WebContext` and serves the page, the bundle and `app_data/<name>` (only for names the core's `is_image_name` accepts). **The web code's
image URLs work unchanged**: no fork.

## What was checked

| Where | Result |
|---|---|
| jsdom (`verify.sh`, no browser) | The shared showcase note (`apps/ios/conformance/preview-showcase/note.md`, which uses every component) renders: 5 headings, a table, a highlighted code block, 2 images, 2 `<mark>`s, 15 links, footnote references; the bridge posts `ready` and `rendered` |
| Claude's Chromium-based browser pane, over a static server | TOC card, `<Info>` and `<Warning>` panels with icons, `<Mark>`, footnote, the image and the Drawio PNG, the line and pie `<Chart>`s, in the dark scheme with the desktop's CSS. **Not WebKit** |
| **WebKitGTK 2.52.6 in the Ubuntu 24.04 container**, inside the libadwaita window, beside the GtkSourceView editor | **Every component of the showcase note drew, except the `<YouTube>` player** (a grey box: that run had **no network**). Seen in `screenshots/`: `webkitgtk-split-dark.png` (Toc, Info, Warning, `<Mark>`, footnote reference, beside the editor), `webkitgtk-preview-dark-image-diagram-linechart.png` (image, `<Drawio>` PNG, line chart), `webkitgtk-preview-light-scrolled.png` (pie chart, `<Repo>` card, light), `webkitgtk-preview-dark-table-code-footnotes.png` (the invalid-`<Repo>` fallback, table, task list, quote, highlighted code, the footnote list with back-links), `webkitgtk-split-720px-light.png` |
| The bridge, WebKit to Rust | `ready` and `rendered` (with the heading count) arrive through `UserContentManager`. A note-link click posts `open-note` (wired, **not clicked in any run**) |
| The bridge, Rust to WebKit | Putting a note into the editor re-renders the preview 150 ms later through `evaluate_javascript`; that is the path typing takes, but **typing itself was not exercised** |

Tailwind v4 needs Safari 16.4 or newer; WebKitGTK 2.52 is much newer (an inference from version numbers, borne out by the screenshots).

## The sandbox, stated plainly

WebKitGTK sandboxes its web process with **bubblewrap**, which needs unprivileged user namespaces. Docker's default seccomp profile
denies them, so in this container `bwrap` fails (`No permissions to create new namespace`) and no web process starts. The screenshots
above were taken with `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`, **with the user's explicit approval in chat for a throwaway
container, no network, only this bundle**. (An earlier attempt to set the variable was refused by the session's safety classifier; the
approval came afterwards.) **Sandbox-on behaviour is therefore unverified**, and on Ubuntu 24.04 there is a second thing to check on a
real machine: that release restricts unprivileged user namespaces with AppArmor by default, which has broken other bwrap and Chromium-style
sandboxes. Whether the system `bwrap` is allowed by Ubuntu's profile for a WebKitGTK app installed from a `.deb` is **not verified**.
The VM gate (S6) must run the preview with the sandbox **on**.

## Memory, with the preview on

The whole app after the showcase note rendered and 8 s idle (`../container/webkit-footprint.sh`; arm64 container, software rendering,
sandbox off; PSS counts shared pages in proportion):

| | `GSK_RENDERER` default (GL on llvmpipe) | `GSK_RENDERER=cairo` |
|---|---:|---:|
| the shell | 254 MB | 129 MB |
| `WebKitWebProcess` | 174 MB | 171 MB |
| `WebKitNetworkProcess` | 20 MB | 26 MB |
| **Total PSS** | **452 MB** | **329 MB** |

**This is not a demonstrated saving over Electron.** The earlier measurement of Electron idle on a Mac was 395 MB (a different OS, a
different method). The GL figure is inflated by software rendering, the Cairo one by nothing but the app, and neither includes
Meilisearch (the decided search). The web process alone is about 170 MB for this bundle. Real numbers need a real GPU and the VM or a
physical machine (gate B and C). The case for the native app is how it *feels* and what it integrates with, not its footprint, until a
measurement says otherwise.

## What is not done

- Sandbox on; a real desktop; fonts and emoji as GNOME renders them; the WebKit dark-mode media query following the system (the shell sets
  `data-theme` itself).
- Only `NoteMarkdown`. The frontmatter card, the heading rail, the highlight menu, find-in-note and the Drawio editor are other
  components that the desktop wraps around it; the desktop's `PreviewHighlightMenu` is a right-click menu that would need a native
  replacement.
- **Edits made from the preview** (the draw.io editor, the `<Sheet>` component that is in design): the bridge carries messages out, but nothing
  here writes a change back into the editor buffer.
- Drag and drop onto the preview; text selection to the clipboard; link handling (external links should open in the default browser,
  not navigate the view); `decide-policy` to keep the view on `app://`.
- The bundle's size on disk in a package, and its start-up time (not timed).
