# Manual test: opening plugin panels from the palette and the rail

A walkthrough to run by hand in the desktop app. `pnpm --dir apps/desktop smoke` drives the real app through the palette's Open commands,
the rail's icons, opening from Home, Toggle Plugin Rail and Hide from Rail; this is what checks the parts a script can't see (how the icons
look, hover text, the light theme, narrow windows, Settings on screen, keyboard-only use).
What the feature does: [ui/panels.md](../ui/panels.md#opening-a-plugins-panel). Plan and decisions: [plugin-launcher-plan.md](../plugin-launcher-plan.md).

Use a scratch home so your own notes and settings are not touched (the rail's choices live in the browser storage of that home too):
`COMPOSITION_DEV_HOME=/tmp/composition-dev pnpm --dir apps/desktop dev`.

## 1. The rail on a fresh install

- [ ] A narrow column of icons sits left of the **Notebooks** column, under the header, full height. There are three: Notes browser, AI helper, To-do. (Reading List and RSS Reader start off.)
- [ ] The icons are easy to tell apart at a glance, in the dark theme **and** the light theme, and none looks like the Notebooks column's own book icon.
- [ ] Hover each icon: its name appears.
- [ ] Tab into the rail from the search box: each icon takes focus in turn, with a visible focus ring, and Enter opens its panel.

## 2. Opening from the rail

- [ ] Click **To-do**: the empty panel fills with the to-do list, the icon shows as pressed, and the cursor is in the panel's box.
- [ ] Click **AI helper**: a new panel appears to the right of the focused one.
- [ ] Click into a note, then click **To-do** again: the cursor goes to the to-do panel; no second to-do panel appears.
- [ ] Click **Notes browser** twice: each click makes a new notes browser.
- [ ] Close the to-do panel: its icon is no longer pressed.
- [ ] Click **Home**, then an icon: the Home page goes and the panel is there. Open a group's page, then an icon: the same.

## 3. Opening from the palette

- [ ] `Cmd+Shift+P`, type `to-do`, Enter: the same as the rail. Try `tasks`, `feeds` (nothing yet), `read later` (nothing yet), `ai`, `notebook`.
- [ ] The list shows **Open Notes Browser**, **Open AI Helper** and **Open To-do**, then **Toggle Plugin Rail**, with the panel commands before them. No Open command has a key beside it.
- [ ] From **Home**, run **Open AI Helper**: the panels come back.
- [ ] In a **pop-out**, `Cmd+Shift+P`: the Open commands are there and open a panel in the pop-out; **Toggle Plugin Rail** is not listed, and the pop-out has no rail.

## 4. Plugins on and off

- [ ] Settings → Plugins: tick **RSS Reader** and **Reading List**. Go back: both icons are there, in the order Notes browser, AI helper, To-do, Reading List, RSS Reader, and both Open commands are in the palette.
- [ ] Untick **RSS Reader**: its icon and its palette command go at once; an RSS panel that was open says the plugin is off (and keeps its feeds). Tick it again: the icon returns.
- [ ] Untick **To-do** while a to-do panel is open: the icon goes, the panel says the plugin is off, and an empty panel no longer offers **To-do**.

## 5. Taking icons off the rail

- [ ] Right-click **AI helper** → **Hide from Rail**: the icon goes. The AI helper plugin is untouched: **Open AI Helper** is still in the palette, and an empty panel still offers **AI helper**.
- [ ] Settings → General → Panels: under **Icons in the plugin rail** the AI helper box is unticked and the others ticked. Tick it: the icon is back.
- [ ] Untick **RSS Reader** there, then turn the **RSS Reader** plugin off in Settings → Plugins: its box is disabled and says the plugin is turned off. Turn the plugin back on: the box is still unticked and the icon is still hidden.
- [ ] Untick every box: the rail disappears completely (no empty strip). Tick one: it returns.
- [ ] Quit and relaunch: every choice above is as you left it.

## 6. Turning the whole rail off

- [ ] Settings → General → Panels: untick **Show the plugin rail**. Go back: the column is gone and the panels use the room. The per-icon boxes are disabled, with their ticks as they were.
- [ ] `Cmd+Shift+P`, `rail`, Enter (**Toggle Plugin Rail**): the rail returns; again: it goes. The Settings box follows when you open Settings.
- [ ] With the rail off, tab through the main window: nothing is left to tab through where the rail was. Every panel still opens from the palette, and from an empty panel.

## 7. A narrow window

- [ ] Drag the main window down to its smallest (760 × 480). The rail, the Notebooks column and the note list leave one narrow panel; opening a plugin from the rail still works and the panel is usable.
- [ ] Collapse the Notebooks column (the button at its top): the rail stays, and the panel gets the room.
- [ ] Turn the rail off at that size: the panel gains about 48 px.
