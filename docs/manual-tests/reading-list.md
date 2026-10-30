# Manual test: the Reading List plugin

A walkthrough to run by hand in the desktop app. `pnpm --dir apps/desktop smoke:reading-list` drives the real app against a
local fixture site and covers isolation, the keys, pop-outs and the plugin switch; this is what checks real websites and the
parts a script can't see (looks, dragging, paywalls). What the feature does: [ui/panels.md](../ui/panels.md#the-reading-list-panel).
Plan and decisions: [reading-list-plan.md](../reading-list-plan.md).

Use a scratch home so your own notes and settings are not touched (the smoke script's throwaway home does this too):
`HOME=$(mktemp -d) pnpm --dir apps/desktop dev`. You need a few real article links, one of them on a site you can sign in to
(ideally with a paywall), and one that sends `X-Frame-Options` (most news sites do).

## 1. Off by default

- [ ] Settings → Plugins: **Reading List** is **unchecked**, and no **Clear browsing data** button is shown. In an empty panel there is no **Reading List** choice.
- [ ] Tick **Reading List**. **Clear browsing data** appears under it, and an empty panel now offers **Reading List**.

## 2. Add and read

- [ ] Make a Reading List panel. Paste a real article address and press Enter: the row appears, the page loads on the right, and the row's title
  changes from the host name to the page's title. The box is empty and ready for the next one.
- [ ] Paste the same address again, with `#something` on the end: it says it is already in the list and opens that row.
- [ ] Paste `javascript:alert(1)`, `file:///etc/hosts` and `not a link`: each is refused with a reason, and the text stays in the box.
- [ ] Paste an address with no scheme (`example.com`): it is added as `https://example.com/`.
- [ ] A site that forbids framing shows normally (it is a web view, not a frame).
- [ ] Click a link inside the page: the page navigates and **Back** lights up; **Back**/**Forward**/**Reload** work and the address follows. The list does not change.
- [ ] Click a link that opens in a new tab: **your browser** opens it, and no window of Composition opens.
- [ ] Turn off the Wi-Fi and open a link you have not opened: the panel says why it failed and offers **Open in browser**.

## 3. The list

- [ ] **Mark read** (over the page, and in a row's `⋯`): the row dims, its dot goes, and it moves below the unread ones. **Mark unread** reverses it.
- [ ] `⋯` → **Open in browser** and **Copy link** do what they say.
- [ ] `⋯` → **Delete**: a dialog names the link, says it is not sent to the Trash Can, and **Cancel** is focused. **Esc** and **Cancel** delete nothing; **Delete** does.
- [ ] Quit and relaunch: the links, which were read, the open link and the list width are as you left them.

## 4. Layout

- [ ] Drag the divider between the list and the page: it follows the mouse smoothly **over the page** (the page must not swallow the mouse). Release; relaunch; the width is kept.
- [ ] Drag the panel's header, and a divider between two panels, across the page: neither stalls.
- [ ] Make the panel narrower than about 640 px: it shows the list or the page, and **Back to list** returns to the list. Widen it and both show again.
- [ ] Open the same list in two panels: both show the same links; each has its own page and history.
- [ ] **Move to new window**: the pop-out shows the same list and the page reloads. Close it and move it back; the link that was open is still the one open.

## 5. Keys

- [ ] With a page focused (click inside it), press `Cmd/Ctrl+Shift+\` (split), `Cmd/Ctrl+Shift+P` (palette) and `Cmd/Ctrl+Shift+]`: each works as if the focus were in the app. Ordinary typing and `Cmd/Ctrl+W` and the like stay with the page.

## 6. Signing in, and clearing it

- [ ] Sign in to the paywalled site in the panel. Quit, relaunch, open the link: you are still signed in.
- [ ] Open the same site in your normal browser, or a note's link: it does not share that sign-in with the panel.
- [ ] Settings → Plugins → **Clear browsing data** asks first; **Cancel** does nothing. Confirm: the link is still in the list, and the site asks you to sign in again.

## 7. Turning the plugin off with a page open

- [ ] With a page open, untick **Reading List** in Settings → Plugins. The panel (in every window) says the plugin is turned off, no page is loaded, and **Clear browsing data** is hidden.
- [ ] Click **Turn on Reading List** in the panel: the panel comes back with the same list and the same link open, and you are still signed in.
- [ ] Relaunch with the plugin off: no Reading List panel offers a page, and the app starts as before.
