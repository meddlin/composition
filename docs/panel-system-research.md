# Panel system: research

Findings behind the panel system and its pop-out windows, gathered 2026-10-28. The design built on them is in
[panel-system-plan.md](panel-system-plan.md). Facts are either **measured** (by the spike described below), read
from this repo (a file is cited), or read from the installed Radix source (a file and version are cited).
Anything marked **Inference** is my reasoning from those facts. **Not verified** means I did not check it.
Nothing here is implemented.

## The question

The owner wants VS Code-style panels: resizable, each holding one thing (a note, a notes browser, later a to-do
list, the AI helper), and any of them can be pulled into a second window that is still Composition. The hard
part is the second window. Two ways to build it:

- **A: portal.** The main window's React tree renders a panel into a `window.open()` window with `createPortal`.
  One JS realm, one React tree, one source of truth.
- **A′: own realm.** The pop-out is a real page with its own React and its own copy of every library, reading the
  same in-memory store the main window owns, through `window.opener`.

(B, a separate renderer per window with a sync layer through the main process, was set aside early: it needs a
change feed and a conflict rule for the same note in two windows.)

## How the spike was run

A throwaway Electron project, kept out of the repo (the plan turns its checks into smoke-test scenarios, see
[Testing](panel-system-plan.md#testing)). It copied the real app's setup, and used real input events.

- **Versions.** Electron 44.5.1 (Chromium 152.0.7977.130), macOS, React 19.2.8, `radix-ui` 1.6.7
  (`@radix-ui/react-dismissable-layer` 1.1.19, `@radix-ui/react-focus-scope` 1.1.16). The worktree's
  `package.json` asks for React 19.3.0; the checkout the spike borrowed `node_modules` from had 19.2.8.
- **Setup copied from the app.** A privileged `app://` scheme (`standard`, `secure`, `supportFetchAPI`) as in
  [`protocol.ts`](../apps/desktop/src/main/protocol.ts), the same Content Security Policy minus the draw.io
  `frame-src`, `sandbox` and `contextIsolation`, a preload that exposes a bridge.
- **Input.** `webContents.sendInputEvent` for mouse and keys, `insertText` for typing. Windows were set
  always-on-top so macOS occlusion could not hide them. A process started from a background shell did not
  reliably get OS focus, so checks that need it (menus, the clipboard) ran after a `focusOn(window)` helper confirmed both the
  window and `document.hasFocus()`.
- **Runs thrown away.** The first runs reported `visibilityState: "hidden"` and `hasFocus: false` from the start,
  which made the clipboard, ResizeObserver and throttling numbers meaningless. They were rerun after the windows
  were kept on top and focus was confirmed. Only the reruns are reported here.

## Results: spike 1, portal (A)

What works, with no change:

- `window.open("about:blank")` from the sandboxed renderer under `app://` gives a window whose origin is
  `app://composition`, whose document is usable, and which keeps an element written into it through the
  window's own load. It runs in the **same renderer process** as the opener (same OS process id).
  `overrideBrowserWindowOptions` is honoured (size, position, title, background), and the preload bridge is
  present in the new window.
- A React portal puts the DOM in the pop-out's document (the `<textarea>` is not in the main document). Clicks
  and typed text update React state in the one tree.
- The theme follows. Cloning the main document's `<style>` elements and mirroring the `<html>` attributes with a
  `MutationObserver` works under the real CSP, and switching the theme in the main window repaints the pop-out.
- A closing pop-out is detectable (`beforeunload` and `pagehide` fire and `window.closed` is true). Closing the
  main window destroys the pop-outs without any code of ours.

What breaks:

| Finding (measured) | What it means |
|---|---|
| A `document.addEventListener("keydown")` in the main realm never sees keys typed in the pop-out; a listener on the pop-out's own document does. | Every global key listener is wrong in a pop-out. |
| Radix's default `Portal` puts a dropdown menu in the **main** window (1 menu in the main document, 0 in the pop-out). Escape pressed in the pop-out does not close it. | The shadcn wrappers that portal (`components/ui/` dropdown menu, context menu, dialog, alert dialog) would do the same. I read only `dropdown-menu.tsx`: its `Content` renders `Portal` with no `container` option. |
| With `container` set to the pop-out's body, the menu opens in the pop-out and Escape closes it, but **an outside click does not dismiss it** (the same menu in the main window does), and initial focus lands on the last item. | Radix is not realm-safe in these versions, see [Radix source](#radix-source). |
| `textarea instanceof HTMLTextAreaElement` and `instanceof Node` are **false** in the main realm for a pop-out element; `ownerDocument === document` is false. | Every `instanceof HTML*` check fails silently. |
| A `ResizeObserver` built by the main window **never fires** (not even its first notification) for an element in the pop-out. One built from the pop-out's own constructor fired (widths 676, 496, 736 as the window was resized). | Width-dependent layout silently stops working in a pop-out. |
| `window.getSelection()` in the main realm is empty for text selected in the pop-out, programmatically or with the mouse. The pop-out's own `getSelection()` has it. | Selection-based features (the highlight menus) need the element's own window. |
| `navigator.clipboard.writeText` from the main realm is rejected (`NotAllowedError: Document is not focused`) while the pop-out has focus. The pop-out's own `navigator` succeeds, and the reverse holds when the main window has focus. | Copy buttons break in whichever window is not the caller's. |
| With the main window **minimised**, main-realm timers ran at about one tick per second (5 ticks in 3 s, against 137 in a 1.5 s visible baseline), animation frames stopped (1 against 91), and a `setTimeout(500)` took 1357 ms. `backgroundThrottling: false` on the main window made it normal (273 ticks, 183 frames, 508 ms). | Autosave's 500 ms debounce would stretch whenever the main window is minimised and the user is working in a pop-out. |
| After the main window was reloaded, the pop-out stayed open but did nothing (a click left the count unchanged). | Pop-outs must be closed when the main window navigates. |

## Radix source

Why the Radix results above happen, read from the installed packages (`node_modules/.pnpm`):

- `@radix-ui/react-dismissable-layer` 1.1.19, `usePointerDownOutside`: it listens on `ownerDocument`, which it
  gets right (`node?.ownerDocument`), and it even sets `pointer-events: none` on the pop-out's body (measured).
  But `handleInteractionCapture` tests `target instanceof Node` with the **main realm's** `Node`, which is false
  for a pop-out element, so the interaction is treated as intercepted and the dismissal is suppressed.
  **Inference:** this is the cause of the outside-click failure; I did not patch it to confirm.
- `@radix-ui/react-focus-scope` 1.1.16 uses the global `document` throughout (`document.activeElement` to
  decide what was focused, `document.createTreeWalker`, `focusin` and `focusout` listeners). **Inference:** its
  `focusFirst` loop compares against the main document's `activeElement`, which never changes when it focuses a
  pop-out element, so it keeps going to the last candidate. That matches the measured "focus lands on the last
  item"; I did not patch it to confirm.

## Results: spike 2, own realm (A′)

The pop-out is `popout.html`, a real page loaded from `app://composition/`, with its own React and Radix, reading
a plain store object (subscribe, snapshot, actions) that the main window exposes as `window.__store`.

- **Store sync.** Two real clicks and some typed text in the pop-out reached the store and the main window's DOM
  (`count` 2, the text, and the main window's own element showing 2). A change made in the main window showed in
  the pop-out ("count 3").
- **Unmodified code.** A `document.addEventListener("keydown")` written the way `NotePane` does it saw the keys
  typed in the pop-out, with no change.
- **Radix, no patches, default Portal.** The menu opened in the pop-out's document, an outside click dismissed it
  (1 menu, then 0), and Escape closed it.
- **Clipboard.** `navigator.clipboard.writeText` from the pop-out's realm succeeded. A `ResizeObserver` in the
  pop-out's realm fired.
- **Timers.** With the main window minimised (default throttling), the pop-out's own timers ran normally
  (273 ticks, 182 frames in 3 s) and it stayed visible: it is not a child window (`getParentWindow()` is null).
  A store update made from the pop-out while the main window was minimised worked.
- **Lifecycle.** Same renderer process as the opener. Closing the main window destroyed the pop-out. After a
  main-window reload, `window.opener.__store` read from the pop-out was a new, empty store (count 0). **Inference:**
  the pop-out's React would still be subscribed to the old one, so the pop-out must be closed on navigation just
  as in spike 1.

**Inference:** because every library in the pop-out runs in the pop-out's own realm, none of the spike 1 failures
can occur there, and no audit of `document`, `window`, `instanceof` or observers is needed except in the store,
which does not touch the DOM.

## What the app code looks like today

Counts from `apps/web/src`, non-test files, 2026-10-28.

| Hazard in a portal pop-out | Lines |
|---|---|
| `document` or `window` `addEventListener` (five of them `keydown`: `SearchBar`, `NotePane` ×3, `ShortcutsHelper`) | 9 |
| `instanceof HTML*`, `Node`, `Element` (`PreviewHighlightMenu`, `NotePane`, `ShortcutsHelper`) | 3 |
| `document.activeElement` | 7 |
| `ResizeObserver` (`useMinWidth`, `useElementWidth`, `MarkdownHighlight`) | 6 |
| `navigator.clipboard`, `execCommand` | 10 |
| `getSelection` | 6 |
| `document.createElement`, `.body`, `.getElementById`, `.querySelector` | 16 |
| `requestAnimationFrame` | 4 |
| Every mention of the global `window` or `document` (the pattern also matches the desktop clients and settings screens) | 93, in about 37 files |

Under A′ this table is background, not a work list.

Other facts that shaped the design, each read from the repo:

- **State.** All workspace state is `useState` in one component, `Workspace` in
  [`NotesApp.tsx`](../apps/web/src/components/notes/NotesApp.tsx): notes (with content), groups, notebooks,
  favorites, home settings, the open panes, and a map of debounced saves. The AI helper's chats sit in
  `AssistantProvider`. The desktop loads it once over IPC (`useLoaded(loadWorkspace)`).
- **Settings resets the panes.** Settings and Images are separate routes reached with `<Link>`. Leaving `/`
  unmounts the workspace, and coming back reloads it, so today the open panes are lost on a visit to Settings.
- **No change feed.** The preload bridge is request and response only, plus two pushes: the update state and the
  AI helper's events (the latter to the window that asked).
- **One window, nothing else allowed.** [`window.ts`](../apps/desktop/src/main/window.ts) creates one
  `BrowserWindow`, and `setWindowOpenHandler` denies every new window. `window-all-closed` only quits off macOS
  (`index.ts`), so closing the main window on a Mac leaves the app running and `activate` reopens it.
- **Desktop-only is cheap.** [`next.config.ts`](../apps/web/next.config.ts) swaps sibling `*.desktop.*` files in
  the desktop build, for routes (`pageExtensions`) and for modules (`resolveExtensions`).
- **The pane model is shared with the CLI.** [`panes.ts`](../apps/web/src/components/notes/panes.ts) is pure,
  not persisted, and imported by the terminal app through its `backend.ts` seam.
- **Trash keeps ids.** `trashRepo.ts` copies a note's `id` into `trashed_notes` and `restoreNote` puts it back
  under the same id. The Trash Can list returns titles and dates only, not content.
- **Drag payloads are plain ids** under custom types ([`dragTypes.ts`](../apps/web/src/components/notes/dragTypes.ts)),
  so they carry no realm-specific objects.
- **One pane-related shortcut:** `Mod+Shift+L` toggles the AI helper
  ([`shortcuts.ts`](../apps/web/src/components/shortcuts/shortcuts.ts)).
- **A smoke test exists:** [`smoke.mjs`](../apps/desktop/scripts/smoke.mjs), Playwright driving the built app
  against a throwaway `HOME`.

## Not verified

- **Dragging a note between windows.** The payload is a plain string, so it should cross windows, but an
  OS-level drag cannot be driven by synthetic input. Needs a manual test.
- **Arrow-key navigation in Radix menus.** The synthetic key events behaved the same in a control menu in the
  main window as in the pop-out, so the harness could not tell.
- **IME composition, spellcheck and the context menu in a pop-out.** `installContextMenu` is per `webContents`,
  so a pop-out needs it attached when the window is created.
- **Full-screen and Spaces on macOS** with a pop-out on another display or Space.
- **The real stylesheet.** The spike's stylesheet was a few lines. Fonts and Tailwind are expected to load in a
  real page, but this was not measured.
- **Memory and start-up cost of a second copy of the bundle.** The spike's bundle was about 1.4 MB.
- **The undo-history effect of two panels on one note** (see the plan's
  [duplicate note panels](panel-system-plan.md#the-same-note-in-several-panels)).

## Re-creating the spike

If a check needs repeating before the smoke scenarios exist, the shape of the spike was: an Electron main file
that registers the `app` scheme and serves `index.html`, `popout.html` and two esbuild bundles with the real
CSP, creates a sandboxed main window, allows `window.open` for `about:blank` and the pop-out URL with fixed
options, and drives everything through `executeJavaScript(code, true)` and `sendInputEvent`; a renderer bundle
with a portal pop-out, three Radix menus (default Portal, `container` in the pop-out, and a control in the main
window), and a plain external store on `window.__store`; and a pop-out bundle that reads that store through
`window.opener`. Launching through macOS LaunchServices (`open -n -W -a Electron.app --args …`) rather than
directly from a shell is what let the windows take OS focus.

## Found while building Step 3

- **`BrowserWindow.destroy()` still runs the page's unload events** in Electron 44.9: a pop-out that was destroyed from the main process
  saw `beforeunload`, `pagehide`, `visibilitychange` and `unload` (measured with listeners that wrote to the opener). The Electron
  documentation says they are not emitted. A pop-out page therefore cannot tell the app tearing it down from the user closing it; the main
  process, which knows which it did, has to say so.
- **A click within about 50 ms of a Radix menu opening is not an outside click**, in the main window as well as in a pop-out: the layer starts
  listening on the next tick. A pop-out is not at fault, and the spike's finding (menus dismiss correctly in the pop-out's own realm) holds
  when the click comes at a human's pace.

