# Reading List plugin: design and build plan

A list of article links on the left and, on the right, the page of the one you picked, rendered inside Composition, so a
reading list can be read without leaving the app. Status: **proposed (2026-10-28), nothing built.** Revised the same day for
the built-in plugin system that PR #190 added. Anything marked **my pick** is a judgment, not something the owner decided;
**Inference** is reasoning from a fact, not a measurement.

## Goal

The owner keeps a note called *Reading List* of articles to read later. That note stays exactly as it is and is never
written to. The Reading List is a new thing inspired by it: a place to store URLs, pick one, and read it beside the rest of the
workspace.

## It is a built-in plugin, with a panel kind inside

PR #190 made the to-do list the first **built-in plugin** ([`plugins.ts`](../apps/web/src/lib/composition/plugins.ts)): a
fixed, build-time registry, switched on and off in **Settings > Plugins**, where "off" hides the feature and keeps everything it
stored. Outside plugins are still future work. The to-do plugin is therefore the template for this one, and the Reading List
adds to it rather than inventing anything:

| Piece the plugin system already gives | What the Reading List does with it |
|---|---|
| `PLUGINS` registry entry (`id`, `name`, `description`, `host`) | Adds `{ id: "reading-list", name: "Reading List", host: "desktop", … }`. Its toggle appears in Settings > Plugins by itself; the web app lists it, disabled, "Only available in the desktop app" |
| `KINDS[…].plugin` on the panel kind | `reading-list` kind sets `plugin: "reading-list"`: an empty panel stops offering it, and an open one shows `PluginOffPanel` ("The Reading List plugin is turned off", **Turn on Reading List**) with its saved state intact |
| `store.plugins` on the workspace store, shared by every window | Panels, Settings and pop-outs all see a change at once. No new wiring |
| `useSettingsPluginEnabled(id)` for a plugin's own settings sections | The **Clear browsing data** control (below) is hidden while the plugin is off |
| `parsePluginSettings` / `validatePluginSettings` / `savePluginSettings` | Unchanged. The IPC validator builds itself from `PLUGINS`, so the new id is accepted with no validator edit |

What the plugin system does **not** do, and this plan must: it governs the UI only (the to-do panel's IPC and table are "unchanged"
by it). The Reading List has main-process pieces (a `<webview>` guard, a browser session), so turning the plugin off must reach
those too (R11).

## What is decided

From the owner, in the request: a list of URLs, article picked on the left, its page in a webview on the right, the existing
note(s) untouched.

From the owner, 2026-10-28, answering the questions this plan first ended with:

- **Off by default** (R11): the plugin ships switched off, and is switched on in Settings > Plugins.
- **The rest of the questions were left to my picks**, and are settled as below. They are still judgments, not the owner's own words.

Everything else in the tables is **my pick** until the owner says otherwise.

## Decisions this plan adds

| # | Decision | My pick | Why | Cost to reverse |
|---|---|---|---|---|
| R1 | How the page is shown | **Electron's `<webview>` tag** inside the panel | An `<iframe>` cannot work: the CSP's `frame-src` allows only YouTube and draw.io ([`protocol.ts`](../apps/desktop/src/main/protocol.ts)), and most article sites refuse framing (`X-Frame-Options`, `frame-ancestors`). A `WebContentsView` is Electron's current recommendation, but the main process positions it over a rectangle, so it would sit on top of menus, dialogs, drop zones and dividers, and fight the grid and pop-outs. `<webview>` is an element in the panel's own DOM, so it moves, resizes and pops out with the panel | Medium |
| R2 | Isolation of the guest page | **Own persistent partition `persist:reading-list`, no preload, no Node, sandboxed, every permission denied, `allowpopups` off.** `will-attach-webview` on each hosting window forces these and refuses anything but an `http(s)` `src` | The app's UI gets exactly the `window.composition` bridge and nothing else. An arbitrary web page must never see it, nor share cookies with `app://` | Low |
| R3 | The window flag | **`webviewTag: true` on the main window and on pop-outs**, both of which build their own `webPreferences` ([`window.ts`](../apps/desktop/src/main/window.ts), [`popoutWindows.ts`](../apps/desktop/src/main/popoutWindows.ts)) | Off by default in Electron. It is static per window, so it cannot follow the plugin toggle; R11 covers that | Low |
| R4 | What an item is | **`{ id, url, title, read, createdAt, updatedAt }`**, in a new `reading_list` table in the notes database (same style as `todos`, created idempotently in `db.ts`) | One flat list is what the note is. Tags, folders and ordering by hand are future work | Low |
| R5 | Titles | **Taken from the page** (`page-title-updated`) once it loads, saved if the item has none; until then the host name is shown. No fetching from the main process | The CSP says there is no network access for scripts (`connect-src 'self'`); this keeps it that way and needs no HTML parsing | Low |
| R6 | URL rules | **A pure `normalizeReadingUrl(input)`**: trims, adds `https://` when there is no scheme, accepts only `http:` and `https:`, drops the fragment, rejects the rest (`javascript:`, `file:`, `app:`). A URL already in the list is refused with a pointer to the existing item | The renderer is untrusted input, and `src` on a webview is a navigation. Same check in the renderer, the validator in `validate.ts` and the service | Low |
| R7 | One list, many panels | **A `readingList` store on the workspace store**, like `todos`: every Reading List panel in every window shows the same list. A panel's own state is only **`{ selectedId: number \| null, listWidth: number }`**; restore is tolerant (a selected item that is gone shows "Pick an article") so `RestoreContext` does not change | The kind owns its saved state and the host hands it back untouched | Low |
| R8 | Links inside the page | **A click that stays in the tab navigates the webview. A new-window request (`target=_blank`, `window.open`) goes to the user's browser** through the existing `isExternalUrl` check | Reading flows; nothing opens a window of ours (P8, "deny-all except one rule") | Low |
| R9 | Marking read | **A toggle in the panel header and on each row**; read items are dimmed and sorted below unread. No automatic marking | The note is a "read later" list; finishing is the owner's call | Low |
| R10 | Importing the existing note | **Not in v1.** If wanted later, a read-only "Import links from a note…" that parses URLs out of a note's Markdown and never writes to it | The note's format is the owner's, and the owner asked for it to be left alone | Low |
| R11 | What "off" means below the UI | **Off by default, and enforced in the main process.** Two small changes to the plugin system: `PLUGINS` entries get an optional `defaultEnabled` (default `true`, so the to-do entry is untouched) which `DEFAULT_PLUGIN_SETTINGS` and `parsePluginSettings` honour; and `will-attach-webview` refuses to attach while `loadWebSettings().plugins["reading-list"]` is false. The partition is untouched by turning it off (like the items); **Clear browsing data** is the way to wipe it | The to-do plugin only adds UI. This one lets the app load arbitrary web pages and opens `webviewTag` on every window, which a user who never wants it should not carry. The registry's "unchosen means on" rule exists so existing behaviour does not change; a brand-new capability is not existing behaviour. **Cost to reverse:** low, but it touches `plugins.ts`, so the to-do tests are re-run | Low |
| R12 | Plugin-owned setting | **Settings > Plugins gains a "Clear browsing data" button under the Reading List entry**, shown only while the plugin is on (`useSettingsPluginEnabled`). Not a new tab | Plugins is where the toggle already is; the to-do background lives under Styling because it is styling, and this is not | Low |

## Architecture

The same layers the to-do plugin crosses, in the same order (its commits, `337fc6b` and `420230f`, are the checklist):

| Layer | New or changed file | Mirrors |
|---|---|---|
| Registry | `reading-list` in `PLUGINS` and `defaultEnabled` support in [`plugins.ts`](../apps/web/src/lib/composition/plugins.ts); fixtures that list every plugin: `plugins.test.ts`, `webSettings.test.ts`, `service.test.ts`, `PluginsSettings.test.tsx`, `validate.test.ts`, and the CLI's `dataLocation.test.ts` | `420230f`, `d5211c3` |
| Schema | `reading_list` in [`db.ts`](../apps/web/src/lib/composition/db.ts) | `TODOS_SCHEMA` |
| Pure rules | `readingList.ts` (`normalizeReadingUrl`, `hostLabel`, sorting) | `todos.ts` |
| Repo and service | `readingListRepo.ts`, `readingListService.ts` | `todosRepo.ts`, `todosService.ts` |
| API contract | `readingListApi.ts` (`ReadingListApi`, `READING_LIST_METHODS`) | `todosApi.ts` |
| Renderer client | `readingListClient.ts` (via `window.composition`) | `todosClient.ts` |
| Store | `readingListStore.ts` (optimistic changes, reload on refusal), registered in `workspaceInstance.desktop.ts` and `workspaceStore.ts` | `todosStore.ts` |
| IPC | `READING_LIST_VALIDATORS` in `validate.ts`; `ipc.ts`, `preload/index.ts`, `backend.ts`, `index.ts`, `desktopBridge.ts`; `smoke.mjs` method list | the `TODO_*` entries |
| Kind | `reading-list` in `KindId`, `KINDS` (`minWidth` 480, `plugin: "reading-list"`, `initialState`, `restore`), `panelTitle.ts`, `EmptyPanel.tsx` `CHOICES`, `PanelGrid.tsx` (the `!off &&` branch) | `todo` |
| UI | `ReadingListPanel.tsx` (list, add box, toolbar) and `ReadingWebview.tsx` (the only file that knows about `<webview>`) | `TodoPanel.tsx` |
| Settings | Clear browsing data control in the Plugins tab | `TodoLookSettings.desktop.tsx` |
| Main process | `readingListGuard.ts`: `will-attach-webview` (including the plugin check), guest `setWindowOpenHandler`, permission denial; attached by `window.ts` and `popoutManager.ts` | `popoutManager.ts` `guard` |

`ReadingListApi`: `listReadingItems`, `addReadingItem(url)`, `setReadingItemTitle(id, title)`, `setReadingItemRead(id, read)`,
`deleteReadingItem(id)`, `clearReadingData()` (wipes the partition's cookies and cache).

## How the panel behaves

- **Add.** A box at the top of the list: paste a URL, press Enter. It stays open for the next one. A bad URL or a duplicate says why and keeps the text.
- **Pick.** Clicking a row selects it and loads it in the webview. The selection is saved with the layout.
- **Toolbar over the page.** Back, forward, reload, the address (read-only text), **Open in browser**, **Mark read**. Back and forward are the webview's own history; they do not change the list.
- **Row.** Title (or host name until loaded), host name, a dot for unread, and `⋯` with Open in browser, Copy link, Mark read/unread, Delete. Delete **asks first**, with the shared [`ConfirmDialog`](../apps/web/src/components/ConfirmDialog.tsx) the to-do panel and notes use: it names the link (title, else host), says it is removed from the list for good and not sent to the Trash Can (re-adding is a paste), and has **Cancel** as the initial focus so a stray `Enter` backs out. The panel holds one `pendingDelete`, so the row menu and the keyboard take the same path. Nothing is deleted, and nothing is sent to the backend, until it is confirmed. (**Owner's decision**, 2026-10-28.)
- **Narrow panels.** From a container width of about 640 px the list and page sit side by side with a draggable divider ([`ResizeHandle`](../apps/web/src/components/notes/ResizeHandle.tsx)). Below that the panel shows the list or the page, with a **Back to list** button, so a half-width panel still works.
- **Failure.** A page that fails to load shows the reason and **Open in browser**, not a blank rectangle.
- **Same item in two panels.** Allowed, no warning: they share the list, and each has its own webview and history.
- **Moving to a pop-out.** The panel's webview is recreated, so the page reloads; scroll position is not kept. Anything worth keeping is the selected id.
- **Plugin off.** The panel shows `PluginOffPanel` and **no webview exists**, so nothing loads or runs. The list, the selection and the cookies are kept; turning it back on restores the panel as it was.
- **Privacy.** Sign-ins to paywalled sites survive in the `persist:reading-list` partition until **Clear browsing data**.

## Risks to settle before building

1. **Keys do not leave the webview.** Key presses inside a guest page are not delivered to the host page, so the panel commands (`Mod+Shift+\`, `Mod+Shift+W`, `Mod+Shift+P`) will not fire while the page has focus. *Inference:* the main process can see them (`before-input-event` on the guest's `webContents`, found through `did-attach-webview`) and forward the few the app owns. The spike checks it works; if not, v1 ships with "click the panel header to get the keys back" and says so in the docs.
2. **Drags and dividers over the page.** A webview swallows mouse and drag events, as an iframe does, so dragging a divider or a panel header across it would stall. The panel should set `pointer-events: none` on the webview while any panel drag or divider drag is in progress (the grid already knows when one is).
3. **Does the CSP govern `<webview>`?** *Inference:* `default-src 'self'` may block a webview whose `src` is `https:`. If it does, `frame-src` gains a narrowly scoped allowance for the tag (not `https:` wholesale), tested in `protocol.test.ts`. Settled by the spike.
4. **`<webview>` is a discouraged API.** Electron's docs recommend `WebContentsView`, and say the tag's architecture may change. That is the price of R1; `ReadingWebview.tsx` is the only file that touches it, so swapping it later does not touch the list, store or storage.
5. **Pop-outs.** `webviewTag` has to be on in the pop-out's `webPreferences` too, and the guard attached in `popoutManager.guard`; both were written separately and could drift (a test compares them).
6. **The plugin check in the main process reads the settings file on every attach.** *Inference:* cheap (a small JSON read), and `loadWebSettings()` is already called per IPC; confirm it is not cached stale after `savePluginSettings`.
7. **Existing users' settings files have no `reading-list` key.** With R11 that must read as *off*, not on; a test pins it (`parsePluginSettings({ todo: true })` gives `reading-list: false`).

## Build order

Each step ends with a gate; do not start the next until it has passed.

1. **Spike (throwaway), Gate A.** Add `webviewTag` and a bare `<webview>` to a scratch panel. Load a real article that sends `X-Frame-Options`. Answer risks 1, 2 and 3 above, and that it works in a pop-out. Record the answers in this file; delete the spike.
2. **Registry.** `reading-list` entry and `defaultEnabled` in `plugins.ts`, with every fixture that lists the plugins. **Gate B:** `pnpm test` green in all three apps; the to-do plugin's behaviour unchanged; risk 7's test passes.
3. **Storage and rules.** `reading_list` table, `readingList.ts`, repo, service, with tests (`normalizeReadingUrl` table-driven; the service against a temp database as `todosService.test.ts` does). **Gate C:** tests green; the CLI, which shares the database file, still opens it.
4. **Bridge.** API contract, validators (with tests that hostile arguments are refused), IPC, preload, client, `smoke.mjs` method list. **Gate D:** `ipc.test.ts` and the desktop smoke pass.
5. **Store and kind.** `readingListStore.ts` (optimistic add, mark read, delete; reload on refusal) and the `reading-list` kind with its `plugin`; `ReadingListPanel` tests that Delete opens the dialog, Cancel and `Esc` delete nothing, and only the confirm calls `deleteReadingItem`, restore tolerant of a missing item. **Gate E:** store tests; a saved layout containing the kind round-trips through `panelsDocument.ts`; `PanelGrid.test.tsx` gains the plugin-off case for this kind.
6. **Panel UI.** List, add box, narrow/wide layout, toolbar, with `ReadingWebview` behind a small seam so component tests can pass a fake (jsdom has no `<webview>`). **Gate F:** component tests; look at it with `preview_start` on the `web` server as AGENTS.md requires.
7. **Main-process guard.** `readingListGuard.ts`, `webviewTag` on both window types, R2's enforcement, R11's plugin check, the forwarding of keys (if the spike said it works), the CSP change (if it said it is needed). **Gate G:** unit tests for what the guard refuses (a `src` of `file:`, a `preload`, `nodeIntegration`, any attach while the plugin is off); the smoke test loads a local `http://127.0.0.1` fixture page in the webview and confirms `window.composition` is *not* defined inside it.
8. **Settings and docs.** The Clear browsing data control; a **Reading List** section in [panels.md](ui/panels.md), a row in [feature-matrix.md](feature-matrix.md) (desktop only), a line in [index.md](index.md), and `docs/manual-tests/reading-list.md` (real sites, a paywalled sign-in, a pop-out, narrow panel, dividers over a page, keys, toggling the plugin off and on with a page open). **Gate H:** the manual test, run by hand.

## Non-goals and future work

- Tags, folders, hand ordering, search across the list, due dates.
- Reader mode, highlights, or saving a page's text. (Offline reading would mean fetching pages, which the CSP deliberately has no path for.)
- Ad or tracker blocking.
- Importing from, or syncing with, the existing *Reading List* note (R10).
- The web app and the terminal app. A browser tab already is a browser, and a terminal cannot render a page.
- A browser-extension or share-sheet way to add a link.
- Loading plugins from outside the app (still future work, per the plugin system).

## Settled questions

| Question | Settled as | Where it shows |
|---|---|---|
| Off by default, or on like the to-do list? | **Off by default** (owner) | R11, risk 7 |
| Desktop only? | **Yes.** It follows from the webview; the web app could only open links in a new tab, which a browser already does | `host: "desktop"` in the registry; non-goals |
| Delete a link without asking? | **No: it asks first** (owner, replacing my earlier pick of no prompt). Links are not sent to the Trash Can, so the prompt is the only safety net | How the panel behaves, Row |
| Import from the *Reading List* note? | **Not in v1; revisit after it ships.** It would only read | R10 |
| Keep signed-in sessions for paywalled sites? | **Yes**, in the `persist:reading-list` partition, until **Clear browsing data** | R2, R12 |
