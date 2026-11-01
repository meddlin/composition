# Manual test: the RSS Reader plugin

A walkthrough to run by hand in the desktop app. `pnpm --dir apps/desktop smoke:rss` drives the real app against a local fixture
feed and covers subscribing, a page that is not a feed, a conditional refresh, unsubscribing, the plugin switch and the refusal of
this computer's own addresses; this is what checks real feeds and the parts a script can't see (looks, waiting, sleeping, offline).
What the feature does: [ui/panels.md](../ui/panels.md#the-rss-reader-panel). Plan and decisions: [rss-reader-plan.md](../rss-reader-plan.md).

Use a scratch home so your own notes and settings are not touched (the smoke script's throwaway home does this too):
`HOME=$(mktemp -d) pnpm --dir apps/desktop dev`. You need the addresses of a few real feeds: an RSS 2.0 one, an Atom one (a GitHub
repository's `/releases.atom` works), one that is slow or large if you know of one, and a page that is not a feed (any home page).

## 1. Off by default

- [ ] Settings → Plugins: **RSS Reader** is **unchecked**. In an empty panel there is no **RSS Reader** choice, and nothing is fetched (check Activity Monitor or a proxy if you like).
- [ ] Tick **RSS Reader**. An empty panel now offers **RSS Reader**.

## 2. Subscribe

- [ ] Make an RSS Reader panel. It says there are no feeds yet.
- [ ] Paste a real RSS address and press Enter: the box says it is fetching, then the feed appears with its title, an unread count, and its entries, newest first. The box is empty.
- [ ] Do the same with an Atom feed. Entries with no date sort by when they were first seen.
- [ ] Paste the same address again (with or without `https://`, with `#x` on the end): it says you are already subscribed and shows that feed.
- [ ] Paste a page that is not a feed: it says so, nothing is added, the text stays in the box.
- [ ] Paste `javascript:alert(1)`, `file:///etc/hosts`, `http://localhost:7700/` and `http://192.168.1.1/`: each is refused with a reason (the last two say private networks).
- [ ] Paste an address that does not exist (`https://nonexistent.invalid/feed`): it says it could not find the host.

## 3. Read

- [ ] **All entries** lists every feed's entries together, each with its feed's name. Picking a feed lists only its entries.
- [ ] Pick an entry: its title, date and excerpt appear below the list as plain text (no images, no links, no markup). An entry whose feed sent no excerpt says so.
- [ ] **Open in browser** opens your browser (not a window of Composition) and marks the entry read: the dot goes, its feed's count drops, it is dimmed.
- [ ] **Mark read/unread**, a feed's `⋯` → **Mark all read**, and **Mark all read** over the entries all change the counts at once.
- [ ] With **Reading List** switched on in Settings → Plugins, **Send to Reading List** adds the entry's link there; sending it again says it is already in the list. With that plugin off the button is not shown.

## 4. Refresh

- [ ] **Refresh** over the entries fetches the picked feed (or all of them under **All entries**); the feed's row shows a spinner meanwhile.
- [ ] Turn off the Wi-Fi and refresh: the feed shows a warning on its row and a message over the entries saying why, and the entries it already had stay. Turn it back on and refresh: the warning goes.
- [ ] Quit and relaunch with a feed that was fetched more than 10 minutes ago: opening the panel fetches it by itself.
- [ ] Leave the app open (with a window) for over 30 minutes with a feed that publishes often: new entries appear without touching anything. Close every window (the app stays open on macOS): nothing is fetched until a window is open again.
- [ ] Switch to another app and back after a background refresh: the counts are current when the window regains focus.

## 5. Unsubscribe

- [ ] A feed's `⋯` → **Unsubscribe**: a dialog names the feed, says its entries are removed for good and not sent to the Trash Can, and **Cancel** is focused. **Esc** and **Cancel** remove nothing; **Unsubscribe** does, and the panel goes back to **All entries**.
- [ ] Quit and relaunch: the feed is still gone, and so are its entries. Subscribe to it again: it comes back as a new feed with its entries unread.
- [ ] With the same feed open in two panels (or a panel and a pop-out), unsubscribing in one removes it from the other.

## 6. Layout and windows

- [ ] Make the panel narrower than about 640 px: it shows the feeds; picking one shows the entries with **Back to feeds**; picking an entry shows it with **Back to entries**. Widen it and both sides show again.
- [ ] Open the same feeds in two panels: both show the same feeds and counts; each remembers its own open feed and entry across a relaunch.
- [ ] **Move to new window**: the pop-out shows the same feeds; a refresh in either shows in both.

## 7. Turning the plugin off

- [ ] With the panel open, untick **RSS Reader** in Settings → Plugins. The panel (in every window) says the plugin is turned off, and nothing more is fetched (no timer, no refresh).
- [ ] Click **Turn on RSS Reader** in the panel: it comes back with the same feeds, entries, read marks and the same feed open.
- [ ] Relaunch with the plugin off: no RSS Reader panel offers anything, and the app starts as before.

## 8. Odd feeds

- [ ] A very large feed (over 5 MB) is refused with a message saying so, and nothing is stored.
- [ ] A feed that redirects (`http://` → `https://`) subscribes; the stored address is the one you pasted.
- [ ] A feed with markup or scripts in its titles and descriptions shows only text.
