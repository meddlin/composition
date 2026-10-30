# RSS Reader plugin: design and build plan

A list of the feeds you subscribe to, the entries of the one you pick, and a way to unsubscribe, in a panel of their own. Status:
**proposed (2026-10-30), not built.** This is the result of a viability check, not a spike: nothing here has been run. Anything marked
**my pick** is a judgment, not something the owner decided; **Inference** is reasoning from a fact, not a measurement.

## Goal

The owner wants to follow feeds from inside Composition: see which feeds they are subscribed to, read what is new in them, and
unsubscribe from one. It must be a plugin, so it can be switched off and leaves nothing running when it is.

## Verdict

**Viable, and about the size of the Reading List plugin** ([reading-list-plan.md](reading-list-plan.md)), whose layer-by-layer
build is the checklist. The plugin registry, the off-state panel, the shared store, the confirm dialog, the IPC validator pattern
and the idempotent schema all exist. Two things are new:

1. **The app has to fetch feeds.** The renderer's CSP is `connect-src 'self'` on purpose ([`protocol.ts`](../apps/desktop/src/main/protocol.ts)),
   so fetching happens in the main process, with limits. The Reading List never fetched anything (its pages load in a `<webview>`).
2. **Feeds have to be parsed.** The repo has no XML parser and no HTML sanitizer. Feed text is untrusted input in both senses.

What is *not* new: nothing here needs a background service, a new window type or a change to the CSP.

## It is a built-in plugin, with a panel kind inside

| Piece the plugin system already gives | What the RSS plugin does with it |
|---|---|
| `PLUGINS` entry (`id`, `name`, `description`, `host`, `defaultEnabled`) | Adds `{ id: "rss", name: "RSS Reader", host: "desktop", defaultEnabled: false }` ([`plugins.ts`](../apps/web/src/lib/composition/plugins.ts)). The toggle appears in Settings > Plugins by itself; the web app lists it, disabled |
| `KINDS[…].plugin` on the panel kind | `rss` kind sets `plugin: "rss"`: an empty panel stops offering it when off, and an open one shows `PluginOffPanel` with its saved state intact |
| `store.plugins`, shared by every window | Panels, Settings and pop-outs see a toggle at once |
| `parsePluginSettings` / `validatePluginSettings` | Unchanged; the IPC validator builds itself from `PLUGINS` |

What the plugin system does **not** do, and this plan must: it governs the UI only. The RSS plugin has a main-process fetcher and a
timer, so turning the plugin off must stop those too (D10).

## Decisions

All of these are **my pick** until the owner says otherwise. Four are real questions for the owner; they are marked ★ and repeated
in "Open questions".

| # | Decision | My pick | Why | Cost to reverse |
|---|---|---|---|---|
| D1 | Desktop only | **`host: "desktop"`** | Fetching needs the main process. The web app would need its own server route, and the terminal app has no panel to put it in | Medium |
| D2 | Off by default ★ | **`defaultEnabled: false`** | It adds a capability (the app makes network requests on a schedule), as the Reading List does. An existing settings file with no `rss` key must read as *off* (a test pins it, as for `reading-list`) | Low |
| D3 | Where fetching lives | **Main process only**, in a new `feedFetcher.ts` that takes `fetch` as a parameter, as [`releaseFeed.ts`](../apps/desktop/src/main/releaseFeed.ts) does, so tests feed it canned responses. No renderer network access, no CSP change | `connect-src 'self'` is the app's rule that all data goes over IPC | Low |
| D4 | Fetch limits | `http:`/`https:` only; a timeout (about 15 s); a body cap (about 5 MB, enforced while streaming, not after); a redirect cap with the scheme re-checked at each hop; a `User-Agent` naming the app; conditional GET with the saved `ETag` / `Last-Modified`; a `304` means "nothing new" | A feed URL is typed by the user but the server's answer is not trusted. A big or endless body must not fill memory | Low |
| D5 | Private addresses ★ | **Refuse loopback, link-local and private-range hosts** (after DNS, not just by the name typed) | The main process can reach `127.0.0.1`, where the bundled Meilisearch listens, and the user's LAN. Refusing them closes the "app fetches an internal URL for a page" route. Cost: a feed on the user's own network or `localhost` does not work. Inference: that is rare for a desktop reader; if wanted, it becomes a setting | Low |
| D6 | Parser ★ | **`@rowanmanning/feed-parser` 2.x** (RSS, Atom, JSON Feed; built on `fast-xml-parser` 5.x; supports Node 20–26) | Maintained (last release 2026-09), one normalised shape out. Alternative: `fast-xml-parser` plus a small normaliser of our own, which means owning the format quirks. Avoid `rss-parser`: unchanged since 2023, on `xml2js`. Added to `apps/desktop` (the fetcher runs in main), so the web app and CLI do not carry it | Low |
| D7 | What an item is | **Feeds:** `{ id, url, title, siteUrl, etag, lastModified, lastFetchedAt, lastError, createdAt }`. **Entries:** `{ id, feedId, guid, url, title, summary, publishedAt, read }`. `summary` is **plain text**, cut to a length cap, produced by stripping markup | Plain text sidesteps rendering untrusted HTML (D8) | Low |
| D8 | How an entry is read ★ | **v1: a plain-text excerpt, with Open in browser and Send to Reading List.** No rendered feed HTML, no in-panel page | Rendering a feed's HTML needs a sanitizer the repo does not have; an in-panel page needs the webview, whose guard is tied to the Reading List plugin and partition ([`readingListGuard.ts`](../apps/desktop/src/main/readingListGuard.ts)). Send to Reading List calls the existing `addReadingItem` and is offered only while that plugin is on. The webview and sanitised HTML are future work | Low |
| D9 | Refresh | **On opening the panel, a Refresh button, and a timer (about every 30 min) that runs only while the plugin is on and a window exists.** Feeds are fetched one at a time, not all at once | The main process has no scheduler today; this is the smallest thing that keeps a list fresh. Notifications are out of scope | Low |
| D10 | What "off" means below the UI | **Off stops the timer and refuses fetches in the main process** (the service checks `loadWebSettings().plugins.rss` at each fetch, as the Reading List guard does at each attach). Feeds and entries are kept | The plugin system only hides UI; this one runs code on its own | Low |
| D11 | Subscribing | **A box at the top of the feed list.** Paste a feed URL, press Enter. The URL is normalised (trim, `https://` when there is no scheme, `http(s)` only, fragment dropped); the feed is fetched and parsed *before* it is stored, so a URL that is not a feed is refused with the reason. A duplicate points at the existing feed. A page that links to a feed (`<link rel="alternate">`) is **not** auto-discovered in v1 | Subscribing to something that is not a feed would leave a dead row. Discovery means parsing HTML, which is future work | Low |
| D12 | Unsubscribing | **A menu on each feed row, with Unsubscribe; it asks first** with the shared [`ConfirmDialog`](../apps/web/src/components/ConfirmDialog.tsx), naming the feed, saying its entries are deleted for good and not sent to the Trash Can, with Cancel as the initial focus. One `pendingUnsubscribe` in the panel, so the menu and the keyboard take the same path. The repo deletes the feed and its entries in **one transaction** | The same shape as the Reading List's delete. **The codebase declares no foreign keys** (see the `todos` schema comment in [`db.ts`](../apps/web/src/lib/composition/db.ts): the repo does the cascade), so `ON DELETE CASCADE` is not available and the transaction is what keeps entries from being orphaned | Low |
| D13 | Keeping entries | **Keep the newest N per feed (about 200) plus every unread one, pruned after each refresh.** Entries are matched by `guid`, falling back to the link | Without a cap a busy feed grows the database for ever; dropping unread entries would lose what the user has not seen | Low |
| D14 | One list, many panels | A **`feeds` store on the workspace store**, like `todos`; a panel's own saved state is only **`{ selectedFeedId: number \| null, selectedEntryId: number \| null }`**, restored tolerantly (a feed that is gone shows "Pick a feed") | The kind owns its saved state and the host hands it back untouched | Low |
| D15 | Marking read | **Per entry (toggle), plus Mark all read on a feed.** Opening an entry in the browser marks it read; nothing else does so automatically | Finishing is the user's call; opening is a clear signal | Low |

## Architecture

The same layers the Reading List crossed, in the same order:

| Layer | New or changed file | Mirrors |
|---|---|---|
| Registry | `rss` in `PLUGINS`; every fixture that lists the plugins (`plugins.test.ts`, `webSettings.test.ts`, `service.test.ts`, `PluginsSettings.test.tsx`, `validate.test.ts`, the CLI's `dataLocation.test.ts`) | `reading-list` |
| Schema | `feeds` and `feed_items` in [`db.ts`](../apps/web/src/lib/composition/db.ts), `CREATE TABLE IF NOT EXISTS`, a unique index on `feeds.url` and on `(feed_id, guid)`, no foreign keys | `READING_LIST_SCHEMA` |
| Pure rules | `feeds.ts`: `normalizeFeedUrl`, `plainText` (strip markup, collapse space, cut), `entryKey` (guid or link), sorting | `readingList.ts` |
| Repo and service | `feedsRepo.ts`, `feedsService.ts`: list, add (given an already-parsed feed), unsubscribe (transaction), mark read, upsert entries, prune. **No network here**, so the CLI and tests can load it | `readingListRepo.ts`, `readingListService.ts` |
| Fetch and parse | `apps/desktop/src/main/feedFetcher.ts` (D3–D5, `fetch` injected) and `feedParse.ts` (wraps the parser, returns the pure shape); `feedRefresh.ts` for the timer and "off" check | `releaseFeed.ts` |
| API contract | `feedsApi.ts` (`FeedsApi`, `FEED_METHODS`) | `readingListApi.ts` |
| Renderer client, store | `feedsClient.ts`, `feedsStore.ts` (optimistic read/unsubscribe, reload on refusal), registered in `workspaceInstance.desktop.ts` and `workspaceStore.ts` | `readingListClient.ts`, `readingListStore.ts` |
| IPC | `FEED_VALIDATORS` in `validate.ts` (re-check the URL, ids and lengths); `ipc.ts`, `preload/index.ts`, `backend.ts`, `index.ts`, `desktopBridge.ts`; `smoke.mjs` method list | the `READING_LIST_*` entries |
| Kind | `rss` in `KindId`, `KINDS` (`minWidth` 480, `plugin: "rss"`, `initialState`, `restore`), `panelTitle.ts`, `EmptyPanel.tsx` `CHOICES`, `PanelGrid.tsx` | `reading-list` |
| UI | `FeedsPanel.tsx`: feed list, subscribe box, entry list, excerpt view, toolbar | `ReadingListPanel.tsx` |

`FeedsApi`: `listFeeds` (with unread counts), `subscribeFeed(url)`, `unsubscribeFeed(id)`, `listFeedEntries(feedId)`,
`refreshFeed(id)`, `refreshAllFeeds()`, `setFeedEntryRead(id, read)`, `markFeedRead(feedId)`.
"Send to Reading List" and "Open in browser" go through methods that already exist (`addReadingItem`, the external-URL path).

## How the panel behaves

- **Feed list.** Each row: title (the host name until the first fetch), unread count, and a dot or message when the last refresh failed (hover for the reason). Menu: Refresh, Open site in browser, Copy feed address, **Unsubscribe**.
- **Subscribe.** The box described in D11. It stays open for the next one; a bad URL, a non-feed or a duplicate says why and keeps the text.
- **Entries.** Newest first; unread in bold; a row shows title, date and the feed's name when "All entries" is chosen. Picking one shows its excerpt, its date and link, with **Open in browser**, **Send to Reading List**, **Mark read/unread**.
- **Unsubscribe.** Asks first (D12). Nothing is deleted, and nothing is sent to the backend, until it is confirmed.
- **Refresh.** Per feed, all, and the timer (D9). A refresh that fails keeps the old entries and records `lastError`; it does not delete anything.
- **Narrow panels.** As the Reading List: side by side from about 640 px of panel width, one view at a time below, with a back button.
- **Plugin off.** The panel shows `PluginOffPanel`; the timer is stopped; fetches are refused. Feeds, entries and read marks are kept.
- **Pop-outs.** A pop-out shows the same store, so a refresh in one is visible in the other.

## Risks to settle before building

1. **Parser against the bundle.** `esbuild` bundles the main process ([`build-main.mjs`](../apps/desktop/scripts/build-main.mjs)); confirm the parser bundles cleanly and the license collector (`collect-licenses.mjs`) picks it up. *Inference:* it is plain JavaScript, so this should be fine, but it is the first runtime dependency for the main process besides `better-sqlite3` and `electron-updater`.
2. **Real-world feeds are messy.** Wrong content types, broken encodings, HTML in titles, relative links, dates in odd formats, feeds with no `guid`. The parser normalises some of it; the rest is `feeds.ts`. Settle with a fixture set of real feeds (RSS 2.0, Atom, JSON Feed, one malformed).
3. **Private-address check (D5).** Checking the typed host is not enough (a name can resolve to `127.0.0.1`, a redirect can point there). Electron's `net.fetch` / Node `fetch` do not offer a resolve hook, so this likely needs a resolve-then-connect step or checking each redirect hop. Settle with a small spike; if it proves too costly, ship with the typed-host and redirect check and say so.
4. **Large databases.** Entry counts are bounded by D13, but the first fetch of a feed with thousands of items should be trimmed *before* insert. Index `feed_items (feed_id, published_at)`.
5. **The timer and sleep.** A 30-minute timer does not fire while the machine sleeps; on wake the first tick refreshes. No catch-up logic is planned.
6. **Settings files from before the plugin have no `rss` key.** It must read as *off*, not on; a test pins it.
7. **Date handling.** Store `publishedAt` as ISO text; when a feed gives none, use the first-seen time so the entry still sorts.
8. **Smoke test.** Like `smoke-reading-list.mjs`, a local fixture server (feeds on `http://127.0.0.1`) is needed to drive the real app. D5 refuses loopback, so the fetcher needs a test-only switch, or the smoke test must set up an allowed host. Decide with D5.

## Build order

Each step ends with a gate; do not start the next until it has passed.

1. **Spike (throwaway), Gate A.** In the main process, fetch and parse a handful of real feeds (RSS 2.0, Atom, JSON Feed, a malformed one) with the chosen parser, bundled by `build-main.mjs`. Answer risks 1, 2 and 3. Record the answers in this file; delete the spike.
2. **Registry.** `rss` in `PLUGINS` with every fixture. **Gate B:** `pnpm test` green in all three apps; the to-do and Reading List plugins unchanged; risk 6's test passes.
3. **Storage and rules.** Tables, `feeds.ts`, repo, service, with tests (`normalizeFeedUrl` and `plainText` table-driven; the service against a temp database; unsubscribe leaves no orphan entries; pruning keeps unread). **Gate C:** tests green; the CLI, which shares the database file, still opens it.
4. **Fetch and parse.** `feedFetcher.ts` and `feedParse.ts` with `fetch` injected: timeout, size cap, redirects, `304`, a non-feed, a hostile body (huge, deeply nested). **Gate D:** unit tests for every refusal in D4 and D5.
5. **Bridge.** API contract, validators (hostile arguments refused), IPC, preload, client, `smoke.mjs` method list. **Gate E:** `ipc.test.ts` and the desktop smoke pass.
6. **Store and kind.** `feedsStore.ts` and the `rss` kind; tests that Unsubscribe opens the dialog, Cancel and `Esc` delete nothing, and only the confirm calls `unsubscribeFeed`; restore tolerant of a missing feed. **Gate F:** a saved layout containing the kind round-trips through `panelsDocument.ts`; `PanelGrid.test.tsx` gains the plugin-off case.
7. **Panel UI.** Feed list, subscribe box, entries, excerpt view, narrow/wide layout. **Gate G:** component tests; look at it with `preview_start` on the `web` server as AGENTS.md requires.
8. **Refresh and "off".** The timer, the plugin check at each fetch (D10), refresh on open. **Gate H:** a test that turning the plugin off stops the timer and refuses the next fetch; a smoke test (`pnpm smoke:rss`) that subscribes to a fixture feed, sees its entries, unsubscribes and sees them gone.
9. **Docs.** An **RSS Reader** section in [ui/panels.md](ui/panels.md), a row in [feature-matrix.md](feature-matrix.md) (desktop only), a line in [index.md](index.md), and `docs/manual-tests/rss.md` (real feeds, a failing feed, a feed that is not a feed, unsubscribe, a pop-out, toggling the plugin off and on, the machine offline). **Gate I:** the manual test, run by hand.

## Non-goals and future work

- Reading the article inside the panel (the Reading List's webview, with its guard generalised to a second partition and plugin), and rendering a feed's own HTML (needs a sanitizer).
- Feed auto-discovery from a site's address, OPML import and export, folders or tags, search across entries.
- Notifications, a badge on the dock icon, or fetching while the app is closed.
- Full-text fetching, offline reading of articles, podcast playback or enclosure downloads.
- Authenticated feeds (cookies, basic auth, tokens).
- The web app and the terminal app (D1).
- Loading plugins from outside the app (still future work, per the plugin system).

## Open questions

| Question | My pick | Where it shows |
|---|---|---|
| Off by default? | **Yes** | D2, risk 6 |
| Refuse feeds on loopback and private addresses? | **Yes**, with a setting later if wanted | D5, risk 3, risk 8 |
| How is an entry read in v1? | **Excerpt, Open in browser, Send to Reading List**; webview and sanitised HTML later | D8 |
| Which parser? | **`@rowanmanning/feed-parser`** | D6, risk 1 |
