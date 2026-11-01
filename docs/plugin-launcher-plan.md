# Opening plugin panels without an empty panel: design and build plan

Today a plugin's panel can only be reached by first making an **empty panel** (`+`, Split Right) and then choosing the kind in
it. Status: **step 1 built (2026-11-01), steps 2–4 not started; see "What step 1 found".** Anything marked **my pick** is a judgment, not something the owner
decided; **Inference** is reasoning from a fact, not a measurement. The three questions the owner has not answered yet are
marked ★ and repeated in "Open questions".

## Goal

Make the panel kinds easy to reach (AI helper, To-do, Reading List, RSS Reader, and the Notes browser) in two ways borrowed from VS Code:

1. **The command palette** lists them: `Mod+Shift+P`, type *rss*, Enter.
2. **A narrow rail** to the left of the Notebooks column, with one icon per kind. Clicking one opens that kind's panel.

The empty panel's chooser stays as a third way in.

## Verdict

**Viable and small.** Nearly everything it needs exists:

| Already there | Where |
|---|---|
| A command palette, per window, with fuzzy search | [`PanelCommandPalette.tsx`](../apps/web/src/components/panels/PanelCommandPalette.tsx), [`panelCommands.ts`](../apps/web/src/components/panels/panelCommands.ts) |
| Panels know their plugin, and an off plugin is not offered | `KINDS[kind].plugin` in [`kinds.ts`](../apps/web/src/components/panels/kinds.ts) |
| A kind's starting state, and a way to put a new panel beside one | `initialState()`; `splitPanel` and `setPanelKind` in [`panelsState.ts`](../apps/web/src/components/panels/panelsState.ts) |
| The web/desktop seam, so the desktop-only rail does not ship in the web app | `noteSurface.tsx` (web) and `noteSurface.desktop.tsx` (see [`next.config.ts`](../apps/web/next.config.ts)) |
| Per-viewer preferences in `localStorage`, and a Settings → General → Panels section | [`panelPrefs.ts`](../apps/web/src/components/panels/panelPrefs.ts), `PanelSettings.desktop.tsx` |

What is missing, and is the actual work: **one list of launchable kinds** (today `EmptyPanel.tsx` has a private `CHOICES` array,
and `panelTitle.ts` repeats the names), **an "open this kind" rule**, and **a way to leave Home or a group page** when a panel is
opened (below).

Two things the owner may not expect:

1. **Two of the four plugins are off by default** (`reading-list` and `rss` have `defaultEnabled: false`, because they make the app
   load pages and fetch feeds). A rail and a palette that hide an off plugin will not show them to most people, so discoverability
   for those two is only partly fixed. See D6 and Open question 3.
2. **Panels are only visible when the Note area is.** `NotesApp` shows Home, or a group's page, *instead of* the panels. A panel
   opened from the palette or the rail while Home is showing would open out of sight. Both must switch back to the panels (D8).

## Decisions

| # | Decision | My pick | Why | Cost to reverse |
|---|---|---|---|---|
| D1 | One list ★ | **A `LAUNCHERS` list in a new `panels/launchers.ts`:** `{ kind, label, icon, keywords, reuse }` for `ai`, `todo`, `notes-browser`, `ai`, `todo`, `reading-list`, `rss`, in that order (the empty panel's existing order, so it does not change). The empty panel, the palette and the rail all read it; `EmptyPanel` puts its own **Note** button first. `Note` is not a launcher: a note is opened from the sidebar, and a note panel with no note is a state the empty panel already offers | Adding a plugin then touches one list, not three. The plugin gate is **not** repeated here: it is read from `KINDS[kind].plugin` | Low |
| D2 | Where icons live | **In `launchers.ts` (a lucide icon per kind), not on the `PLUGINS` entries** | [`plugins.ts`](../apps/web/src/lib/composition/plugins.ts) is the registry the desktop's settings validators are built from (**Inference:** from the RSS plan, "the IPC validator builds itself from `PLUGINS`"), so it should stay free of UI imports. A launcher is also not always a plugin (AI helper, Notes browser). When third-party plugins exist the icon moves to their manifest | Low |
| D3 | The open rule | **`openKind(window, kind)`:** (1) if the kind is `reuse: "focus"` and the window already has a panel of it, **focus that panel**; (2) else if the focused panel is **empty**, turn it into the kind; (3) else **split right** of the focused panel with a new one, focused. `reuse` is `"focus"` for `ai`, `todo`, `reading-list`, `rss`, and `"new"` for `notes-browser` (a second, independent list is the point of that kind). A second copy of a `"focus"` kind is still made with `+` and the empty panel | Stops repeated clicks stacking duplicates; fills the blank panel the user made on purpose; otherwise behaves like `openAssistantFor`, which already splits right. "This window" means the window the palette is in, or the main window for the rail | Low |
| D4 | The AI helper | **`Open AI Helper` focuses any AI panel in the window (pinned or following); otherwise makes a following one** (`follow: true`, the kind's `initialState`) | A launcher has no note to pin to; the note panel's own `Mod+Shift+L` (and its key) is unchanged and still opens one pinned to that note | Low |
| D5 | Palette entries | **Five commands built from `LAUNCHERS`:** `Open AI Helper`, `Open To-do`, `Open Reading List`, `Open RSS Reader`, `Open Notes Browser`, listed after the panel commands. Keywords find them by other words: *todo* / *tasks* / *checklist*, *feeds* / *news* / *atom*, *links* / *articles* / *read later*, *assistant* / *chat*, *notebook*. **No keys of their own** | Title Case, like *Split Right*. Every command key is `Mod+Shift+<letter>` and the docs already say a clash with a macOS shortcut can only be found by hand; five more is five more risks for a command that is already one search away. `Mod+Shift+L` stays the AI helper's key | Low |
| D6 | A plugin that is off ★ | **Not offered, in the palette or the rail**, the same rule the empty panel has. A small **Manage plugins** button at the bottom of the rail opens Settings → Plugins (if Settings can be opened from the app shell; see risk 6) | Off-by-default plugins are off because turning them on is a consent step (they reach the network). Listing "Open RSS Reader" and landing on the panel's "Turn on" button would also work and is one step shorter, but it makes the palette and the empty panel disagree. **Open question 3** | Low |
| D7 | The rail | **A 48 px column, `<nav aria-label="Plugins">`, left of the Notebooks column, under the header, full height.** One ghost icon button per launcher that is **available** (its plugin is on, D6) **and not hidden by the user** (D13), with `aria-label` and `title` (the repo has no tooltip component; the Home button uses `title`). A kind that has a panel in the main window shows `aria-pressed` and a left accent bar. The same Tab order as the list, **no drag, no reorder, no badges in v1** | Familiar from VS Code and cheap. `title` is how the app labels icon buttons today. Badges (unread RSS, open to-dos) are the obvious next step and need each plugin to publish a count, which is future work | Low |
| D8 | Leaving Home | **The surface takes a `showPanels` callback.** `NotesApp` passes `() => { setHomeOpen(false); setViewedGroupId(null); }` to `useNoteSurface`; the palette's *Open* commands and the rail call it after `openKind` | Home and the group page replace the grid, so an opened panel would otherwise be invisible. The existing commands (Split Right and so on) share this gap while Home is showing; fixing that is out of scope here and noted | Low |
| D9 | Where the rail lives | **Behind the surface seam:** `NoteSurface` gains `rail(...)` (a render function, so `NotesApp` can pass `showPanels`); `noteSurface.tsx` (web) returns `null`, `noteSurface.desktop.tsx` returns the rail. **Main window only:** pop-outs and the web app have none | The web app has no panels and its plugins are listed disabled. A pop-out is a single focused task window, and 48 px is a lot of a 360 px minimum | Low |
| D10 | Turning the whole rail off | **`showPluginRail` in `panelPrefs.ts` (default `true`),** a checkbox under Settings → General → Panels (*Show the plugin rail*), and a palette command **Toggle Plugin Rail**. With it off **the rail is not rendered at all**: no 48 px column, no tab stops. Nothing else changes: every *Open* command stays in the palette and the empty panel still offers every kind | For someone who works entirely from the keyboard the rail is dead width, and it is the one piece of new chrome this plan adds. The window is already tight (Notebooks column + note list + panels). Turning it off must never remove a way to open a plugin, only an icon. `localStorage`, like the Notebooks column's collapse, so it is a per-viewer convenience | Low |
| D11 | Focus after opening | **Palette: unchanged** (its close already puts the cursor in the focused panel). **Rail: after `openKind`, move focus into the panel** with `focusPanelElement`, on the next frame, as the palette does | Keyboard users clicking or pressing Enter on a rail button should land where they can type | Low |
| D12 | The empty panel keeps working | **Unchanged in look and behavior;** it reads `LAUNCHERS` (plus Note) instead of `CHOICES`, and keeps filtering by `KINDS[kind].plugin` | A third entry point costs nothing once it shares the list | Low |
| D13 | One icon off, plugin still on | **`hiddenRailKinds: KindId[]` in `panelPrefs.ts` (default empty).** Settings → General → Panels lists every launcher under *Show the plugin rail* with a **Show in rail** checkbox each (AI helper, To-do, Reading List, RSS Reader, Notes browser). A launcher's icon shows only if its plugin is **on** *and* its kind is **not hidden**. The two settings are independent: hiding an icon never touches the plugin's switch (so its panels, palette command and empty-panel button stay), and turning a plugin off removes its icon whatever the box says. While a plugin is off its row shows the box **disabled with "Plugin is off"** and keeps the saved choice, so turning the plugin back on brings the icon back (or not) as it was. Each rail icon also has a right-click **Hide from Rail** (the repo has `context-menu.tsx`) so an icon can be dropped without opening Settings; getting it back is in Settings. When no icon is left to show, **the rail is not rendered** (as if D10 were off) | A list of *hidden* kinds, not *shown* ones, so a plugin added later appears by default. The per-icon boxes sit in Panels, not on Settings → Plugins, because AI helper and Notes browser are not plugins. Disabling the per-icon boxes while the plugin is off, instead of hiding the rows, keeps the list the same length and says why | Low |

## How it fits together

- **`launchers.ts`** (new): `LAUNCHERS`, the `Launcher` type, and `availableLaunchers(enabled)`, which filters by `KINDS[kind].plugin`.
  The one place to add a plugin's entry.
- **`panelsState.ts`:** a pure `openKind(panels, windowId, kind, newId)` returning `{ panels, panelId }`. It does not know which plugins are on.
- **`workspaceStore.ts`:** `store.openKind(kind, windowId = MAIN_WINDOW): PanelId | null`. It checks `KINDS[kind].plugin` against
  `plugins.getSnapshot().enabled` and returns `null` (changing nothing) for a plugin that is off, so no caller can open one by mistake.
- **`panelCommands.ts` / `runPanelCommand.ts`:** `PanelCommandId` gains `open:<kind>` ids (a template-literal type over the launcher kinds)
  and `toggle-rail`; `PANEL_COMMANDS` is built from `LAUNCHERS`; `searchPanelCommands` takes an `isAvailable` filter so an *Open* command
  for an off plugin is not listed. `runPanelCommand` calls `store.openKind`.
- **`PluginRail.tsx`** (new, in `panels/`): reads `usePlugins(store.plugins)`, the main window's panels, and the rail prefs
  (`showPluginRail`, `hiddenRailKinds`). It shows `availableLaunchers(enabled)` minus the hidden kinds, and renders nothing if that is empty or the rail is off.
  The *Open* commands and the empty panel use `availableLaunchers` only, **never the rail prefs**, so hiding icons cannot remove a way to open a plugin.
- **`panelPrefs.ts`:** `PanelPrefs` gains `showPluginRail` and `hiddenRailKinds`; `parsePanelPrefs` keeps only kinds that are in `LAUNCHERS`
  (an unreadable or unknown entry is dropped, so an old file or a removed plugin cannot break the rail); setters `setShowPluginRail` and `setRailKindHidden`.
- **`PanelSettings.desktop.tsx`:** the master checkbox and one **Show in rail** checkbox per launcher (disabled with "Plugin is off" when
  `KINDS[kind].plugin` is off, and while the master is off).
- **`NotesApp.tsx`:** renders `surface.rail(...)` as the first child of the row that holds the Notebooks column.
- **Docs:** [ui/panels.md](ui/panels.md) (a new "Opening a plugin" section, the palette table), [feature-matrix.md](feature-matrix.md) (desktop only), [index.md](index.md), and `docs/manual-tests/plugin-launcher.md`.

## Risks and unknowns

1. **The web preview cannot show this.** *Settled in step 1: it cannot, and neither can a browser tab on the desktop target.* The `web`
   server in `.claude/launch.json` builds the web target, where the panel grid and the rail do not exist, and the desktop target throws
   "The Composition desktop bridge is unavailable" without Electron's `window.composition` ([`client.desktop.ts`](../apps/web/src/lib/composition/client.desktop.ts)).
   So the rail is looked at in the Electron app: `COMPOSITION_DEV_HOME=/tmp/composition-dev pnpm --dir apps/desktop dev` (a scratch home,
   so real notes are untouched), plus component tests. AGENTS.md's `preview_start` rule cannot be met for steps 2–3; say so in those gates.
2. **Width.** The window has the Notebooks column (default 200, collapsible to 40), the note list, and then the panels. Check the main
   window's minimum size (not found in `apps/desktop/src/main/` while researching this; find where it is set) and look at the rail at that size.
3. **`useNoteSurface`'s signature changes** (a `showPanels` option), and it is also used by the pop-out window, which has no Home.
   Make the option optional so `PopoutApp` is untouched.
4. **Palette scoring.** `searchPanelCommands` scores a query word by label start, word start, keyword, substring, then letters in
   order. *todo* does not start a word of `Open To-do` (the hyphen), so it needs the `todo` keyword; a test pins it. Check that *open*
   does not drown the panel commands and that *split* still finds Split Right first.
5. **Focus order and "focus the existing panel".** A panel of the kind may be in a pop-out only; the rule is per window, so the rail
   (main window) opens a second one. Say so in the docs rather than searching other windows.
6. **Manage plugins button.** Whether Settings can be opened from `NotesApp` (rather than a route the Home page links to) was not checked.
   If it is awkward, drop the button from v1; it is not needed by anything else.
7. **Icons.** `lucide-react` is already used (`HomeIcon`). Pick distinct, plain glyphs and check they read at 20 px; AI helper and
   To-do are the two most likely to look alike in a monochrome rail.

## Build order

Each step ends with a gate; do not start the next until it has passed.

1. **Registry and rule.** `launchers.ts`, `openKind` in `panelsState.ts`, `store.openKind`, `EmptyPanel` reading the list. Answer risk 1
   (can the desktop target be previewed?). **Gate A:** `pnpm test` green in `apps/web`; `EmptyPanel` and `PanelGrid.test.tsx` unchanged;
   a table-driven test of `openKind` (focus an existing one, fill an empty focused panel, split when the focused panel is not empty,
   `notes-browser` always new, an unknown window changes nothing, the main window and a pop-out are separate) and of `store.openKind`
   refusing an off plugin.
2. **Palette.** The *Open* commands, keywords, `isAvailable`, `showPanels` through `useNoteSurface`, and *Toggle Plugin Rail* (a no-op
   until step 3). **Gate B:** search tests (*todo*, *tasks*, *feeds*, *rss*, *read later*, *ai*, *split* still first); a palette test that
   typing *rss* and pressing Enter opens a panel, and that an off plugin is not listed; `runPanelCommand` tests; a test that opening
   from Home returns to the panels.
3. **Rail.** `PluginRail`, `NoteSurface.rail`, `showPluginRail` and `hiddenRailKinds` in `panelPrefs.ts`, the Settings checkboxes,
   the icon's **Hide from Rail**, *Toggle Plugin Rail*. **Gate C:** component tests (only available launchers shown; turning a plugin off
   removes its icon and turning it on restores it; a hidden kind has no icon while its plugin stays on, and its *Open* command, panel and
   empty-panel button are still there; a hidden kind of an off plugin stays hidden when the plugin comes back on; nothing renders when
   the master is off or every icon is hidden; click opens; `aria-pressed` follows the open panels; **Hide from Rail** hides and the
   Settings box shows it unticked; absent in the web surface); `parsePanelPrefs` tests (unknown kinds dropped, junk gives the defaults);
   `PanelSettings.desktop.test.tsx` gains the master box and the per-icon boxes (disabled with the plugin off); **look at it** (preview or the app) at the
   minimum window width and with the Notebooks column collapsed.
4. **Docs and smoke.** The `panels.md` section, `feature-matrix.md`, `index.md`, `docs/manual-tests/plugin-launcher.md`; extend the desktop
   smoke test (it already presses palette keys) to open a panel from the palette. **Gate D:** `pnpm test` in all three apps,
   `pnpm lint:actions` untouched, the manual test run by hand (Home showing, a plugin turned off and on, a pop-out, the rail hidden and shown).

## Non-goals and future work

- Badges or counts on rail icons, drag-to-reorder, and a rail for pop-outs.
- Third-party plugins supplying their own icon and launcher (needs a manifest, the sandbox and signing; see [panel-system-plan.md](panel-system-plan.md)).
- Key bindings for each *Open* command, and an option to open in a pop-out directly.
- Making the existing commands (Split Right and so on) reveal the panels when Home is showing.
- Making a rail click toggle a side view in the Notebooks column, as VS Code's activity bar does: here a click always opens a panel.
- A "recently used" ordering in the palette.
- Hiding a launcher from the **palette** or the empty panel (D13 hides rail icons only; a plugin that should vanish from everything is turned off in Settings → Plugins).
- Syncing the rail preferences between machines or into the workspace file (they are per-viewer, like the Notebooks column's collapse).

## Open questions

1. ★ **Click on an open plugin: focus or add another?** *My pick:* focus the existing panel (D3), with a second copy still one `+` away.
2. ★ **Which kinds are launchers?** *My pick:* the four in the request plus the Notes browser; not Note (D1).
3. ★ **A plugin that is off: hidden, or listed and turned on from the panel?** *My pick:* hidden everywhere, with a **Manage plugins**
   button on the rail (D6). The cost is that Reading List and RSS Reader stay out of sight until switched on in Settings.
4. **Rail on by default?** *My pick:* yes, and switchable off in Settings or from the palette (D10), with each icon hideable too (D13).

## What step 1 found

| Question | Answer |
|---|---|
| Built | [`launchers.ts`](../apps/web/src/components/panels/launchers.ts) (`LAUNCHERS`, `launcherFor`, `isLauncherKind`, `isKindAvailable`, `availableLaunchers`); `openKind` in [`panelsState.ts`](../apps/web/src/components/panels/panelsState.ts); `store.openKind` in `workspaceStore.ts`; `EmptyPanel` reads the list (Note first, then the available launchers, in the same order and with the same names as before). Tests: `launchers.test.ts`, `panelsState.openKind.test.ts`, and a new block in `workspaceStore.panels.test.ts`. |
| Gate A | `pnpm test` in `apps/web`: 172 files, 2662 tests pass; `PanelGrid.test.tsx`'s empty-panel and plugin-off tests are unchanged and pass. eslint is clean on the changed files. Not run: the desktop and CLI test suites (nothing there imports the new code). |
| Order | D1 said `ai` first; it is `notes-browser` first, because that is the empty panel's order and Gate A says it must not change. The rail will list them in the same order. |
| Risk 1 | The desktop target cannot be previewed in a browser (it needs Electron's bridge). See risk 1. |
| Circular import | `panelsState.ts` imports `launchers.ts`, which imports `kinds.ts`; `launchers.ts` imports only *types* from `panelsState.ts`, so there is no cycle. |
| Test mistake worth knowing | A test that built panels by hand with ids `p2`, `p3` collided with the ids the test's counter made; hand-made ids in these tests are `m2`, `m3`. |
| Pre-existing | `pnpm exec tsc --noEmit` in `apps/web` reports one error, `LayoutProps` not found in `src/app/layout.tsx` (a Next-generated type); the file is untouched by this work. |
