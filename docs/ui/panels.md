# Desktop app: panels

Source: [`layoutTree.ts`](../../apps/web/src/components/panels/layoutTree.ts) (the arrangement),
[`panelsState.ts`](../../apps/web/src/components/panels/panelsState.ts) (what each panel is and the rules for opening notes),
[`kinds.ts`](../../apps/web/src/components/panels/kinds.ts) (what each kind saves and how it is read back),
[`panelsDocument.ts`](../../apps/web/src/components/panels/panelsDocument.ts) (the saved form),
[`PanelGrid.tsx`](../../apps/web/src/components/panels/PanelGrid.tsx),
[`noteSurface.desktop.tsx`](../../apps/web/src/components/notes/noteSurface.desktop.tsx) (where the grid replaces the web app's row of panes),
[`PopoutApp.tsx`](../../apps/web/src/components/desktop/PopoutApp.tsx), [`popoutController.ts`](../../apps/web/src/components/panels/popoutController.ts) and
[`popoutManager.ts`](../../apps/desktop/src/main/popoutManager.ts) (pop-out windows).
The design and the reasons behind it are in [panel-system-plan.md](../panel-system-plan.md).

The desktop app shows its open notes in a grid of **panels** rather than the web app's single row of panes
([web-side-by-side.md](web-side-by-side.md)). The web app and the terminal app are unchanged. The header (Home and search), the
notebook list and the note sidebar stay where they are; Home and a group's page still cover the grid while they are open.

## What a panel is

A panel shows one thing, its *kind*:

| Kind | Shows |
|---|---|
| **Empty** | A place to arrange the window before filling it, offering to become one of the other kinds. |
| **Note** | A note, with its Markdown / Preview / Split tabs and its find bar. A note panel with no note yet says so, and takes the next note picked in the sidebar or dropped on it. |
| **Notes browser** | A second tree of a notebook's groups and notes, with its own chosen notebook (a menu at the top). Picking a note opens it in the note panel used last, or in a new one beside the browser. |
| **AI helper** | The [AI helper](ai-helper.md)'s chat about one note. See below. |
| **To-do** | A to-do list. See below. |

A window always has at least one panel. Closing the last one leaves a new empty panel; an empty panel that is already alone has no close button.

## Making and arranging panels

| How | Result |
|---|---|
| **`+`** in a panel's header | A new empty panel to the right. **Option-click** puts it below. |
| **`⋯` → Split right / Split down / Close** | The same, from the panel's menu. |
| Drag a note (from the sidebar) onto a panel's **edge** | A new note panel on that side. |
| Drag a note onto a panel's **middle** | It fills an empty panel, or replaces the note in a note panel (keeping its tab). |
| Drag a panel by its **header** onto another panel | On an edge it moves there, taking half of that panel's room. On the middle the two trade places. |
| Drag a **divider** (or use the arrow keys on it) | The two panels beside it trade room. A panel never gets narrower than 240 px or shorter than 120 px. |

Dropping shows where the panel will land: the half of the target nearest the pointer. Dividers can be nested without limit
(a column inside a row inside a column), and closing a panel hands its room to the panel after it.

Picking a note in the sidebar **focuses** the panel that already shows it; otherwise it goes in the focused panel if that is an empty or note
panel, else in the note panel used last, else in a new panel to the right. So ordinary navigation never makes a second panel for a note.

## Pop-out windows

A panel can be pulled into a window of its own, which is still Composition: `⋯` → **Move to new window**, **Move to window ▸** (another pop-out),
or, from a pop-out, **Move back to main window**. A pop-out has its own grid, which can be split and arranged like the main window's, and shows
only panels (no notebook list, sidebar or search). Its title is the title of the panel in front.

- **One workspace.** A note open in the main window and in a pop-out is one copy: typing in either shows in both, and is saved once.
  Each pop-out is a page of its own (its menus, focus, clipboard and spellcheck work as in any window); what it shares with the main window
  is the workspace, through `window.opener`. See [panel-system-research.md](../panel-system-research.md) for why.
- **Closing.** Closing a pop-out closes its panels, after what was typed in it is sent. Closing the last panel of a pop-out, or moving it back,
  closes the window. The main window always keeps a panel.
- **The main window going.** Closing or reloading the main window closes every pop-out with it (they show the main window's workspace, which
  that page holds). The layout saved on disk still has them, so they come back with the main window, including after Cmd+Q and a relaunch,
  or reopening the app on macOS.
- **Settings and Images** leave pop-outs open. A color scheme or font chosen in Settings reaches them at once.
- **Where they are.** Each pop-out's place and size are remembered (`window-state.json`, written by the main process, which is what sees
  windows move), and one on a display that is gone is brought back onto one that is there. A pop-out never opened before appears just beside
  the main window.
- **Not shared.** The split between a note's editor and preview is per pop-out, and starts from the saved one. A panel dragged by its header
  works within one window; a *note* can be dragged between windows.
- **The AI helper** in a pop-out works as in the main window, and its chats are the main window's, so an answer is streamed by the main
  window and closing the pop-out never cuts one off.
- **Quitting** sends what every window still holds before the database closes.

## The AI helper as a panel

The [AI helper](ai-helper.md) is a panel of its own here, not a dock inside the note, so it can be moved, resized, put in a pop-out or
closed like any other.

- **Opening it.** The speech-bubble button in a note panel's header, or **Cmd/Ctrl+Shift+L** in the note panel you are working in, opens
  an AI helper panel to the right of the note panel, **about that note**, and puts the cursor in its question box. If a panel is already
  about that note in the same window, the button and the shortcut go to it instead of making another. They never close it: close it
  with its own **`⋯` → Close**. (A panel with no note yet has nothing to ask about, so its button does nothing.) An empty panel also
  offers **AI helper**.
- **Which note it is about.** The panel says so in its header (*About Alpha*). Opened from a note it is **pinned** to that note: opening
  another note does not change it. The **link button** in its header makes it **follow** the note you are working in instead: the note
  panel used last in its own window, or, if its window has none, the main window's. Turning following off pins it to the note it was
  about at that moment. An AI helper made from an empty panel starts out following; with no note to follow it says *Open a note to ask
  about it.*
- **Chats** belong to the note, as in the dock: closing the panel, moving it to a pop-out, or opening another one about the same note
  all show the same chat. Changing the note a following panel is about gives it that note's chat and a clean question box.
- **A selection** made in the note's panel (editor or preview) in the same window is offered as *Selection (n characters)* when you click
  into the question box, as in the dock. A note in another window is not read.
- **A deleted note.** An AI helper pinned to a note that is deleted keeps its title struck through and its chat readable, with the
  question box off. Its chat is kept until that panel is closed, then forgotten with the note (a panel that is only following has
  nothing to keep).
- **Saved** with the layout: a pinned panel comes back pinned (or, if its note is gone for good, empty), a following one comes back
  following. Chats are not saved, as before.
- **The web app** keeps the dock inside the note pane; only the desktop app has panels.

## The to-do panel

A plain to-do list in a panel of its own (choose **To-do** in an empty panel). Source: [`TodoPanel.tsx`](../../apps/web/src/components/panels/TodoPanel.tsx),
[`todosStore.ts`](../../apps/web/src/lib/composition/todosStore.ts) (the list and the background, shared by every window) and
[`todosService.ts`](../../apps/web/src/lib/composition/todosService.ts) (the `todos` table in the notes database).

- **Adding.** Type in the box at the top and press Enter; the box stays for the next one. The **+** on an item adds a **sub-item** under it
  (sub-items nest without limit, and the box stays open for more; Escape closes it).
- **Renaming.** The pencil on an item, or double-click its title. Enter saves, Escape gives up.
- **Done.** The checkbox ticks an item off and its text is struck through and dimmed. Ticking an item does not tick its sub-items.
- **Deleting.** The bin on an item. An item with sub-items asks first, because they go with it.
- **Folding.** The arrow beside an item with sub-items hides or shows them; which are folded is saved with the panel's layout.
- **Background.** **Settings > Styling > To-do background** (desktop app only) gives the to-do panels a **pattern** (*Same as notes*, *Plain*, *Grid*,
  *Dots* or *Ruled lines*) and a **color** (a few presets, any color from the picker, or the color scheme's own), with a small preview. It is
  **one setting for every to-do panel**, in any window, and is separate from the note background above it: *Same as notes* follows that
  setting, and the other patterns draw whatever you pick, whatever it says. It applies at once, including in pop-outs, and is saved in the
  settings file (`todoLook`). A chosen color also sets the text color to light or dark, whichever reads better on it, so it works under every
  color scheme. **Reset to default** undoes both.
- **One list.** The items belong to the workspace, not the panel: any number of to-do panels, in any window, show and change the same list,
  and it is saved in the database as you go, so closing a panel loses nothing.

## Panel commands and the command palette

Every panel command can be run from the **command palette**, and the ones that are used most have keys. Both act on the **focused panel
of the window you are in**, so in a pop-out they act on the pop-out's panels.

| Command | Keys | What it does |
|---|---|---|
| **Split Right** | `Mod+Shift+\` | A new empty panel to the right of the focused one. |
| **Split Down** | | The same, below. |
| **Close Panel** | `Mod+Shift+W` | Closes the focused panel (as its `⋯` menu does). |
| **Next Panel** / **Previous Panel** | `Mod+Shift+]` / `Mod+Shift+[` | Moves to the panel after or before this one, **in the order they are laid out** (left to right, top to bottom), wrapping round. |
| **Move to New Window** | | Pulls the focused panel into a window of its own. |
| **Move to Main Window** | | Brings the focused panel of a pop-out back. Does nothing in the main window. |

- **The palette.** `Mod+Shift+P` opens it, from anywhere in a window, with the cursor in its search box. Type to narrow the list (every
  word has to match; a name's initials such as `sr` work, and so do other words such as *pop out* or *below*), **↑ ↓** to move,
  **Enter** to run, **Esc** to close. Each command shows its key. `Mod+Shift+P` again closes it. Each window has its own palette.
- **After a command the cursor goes into the panel it left focused**, not back to the one it was typing in, so typing carries on there.
- **The keys** are matched by the **physical key** (and with Cmd or Ctrl and Shift, never Alt, which AltGr types characters with on
  some layouts), so they work wherever the layout puts the characters. A key held down does not repeat a command. Keys do nothing while the
  palette is open.
- **Not in the native menu.** The commands are not in the menu bar, so a clash with a macOS shortcut can only be seen by hand (the smoke
  test's key presses reach the page, not the menu).
- Also listed under **Keyboard shortcuts** (`Mod+/`) in the desktop app, from the same table the keys are handled from. The AI helper keeps its
  own key, `Mod+Shift+L`.

## The same note in more than one panel

Allowed, and both panels edit one copy of the note, so nothing is lost. **Open to the side**, and dropping a note that is already open
on a panel, make a second panel on purpose and ask first. The question has a box, *Don't warn me again*; **Settings → General → Panels**
turns the warning back on. (A link followed in a preview, and a note picked in the sidebar, never make a second panel.)
**Not yet verified:** typing in one panel may reset the other panel's undo history, because its text box gets a new value.

## A note that was deleted

Deleting a note leaves its panels open, so the layout does not jump. Each shows its title struck through (hover for *Deleted — in the
Trash Can*) and the text grayed out and read-only, but still selectable to copy. Close the panel when you are done. If the note is restored
from the Trash Can in Settings, its panels come back to life; if it is deleted for good, they stay as they were until closed.

## Saving and restoring

The arrangement of every window (the main one and the pop-outs), and what each panel shows, is saved in the desktop settings file under `panels` whenever it changes (a divider drag is saved when
you let go, not at every step), and is brought back when the app opens. A panel that cannot come back (a kind this version does not know, a note
that is gone for good) becomes an empty panel, so the rest survives; a note panel whose note is in the Trash Can comes back deleted. A saved
layout this version cannot read is ignored and the app starts with one empty panel. Which panel was focused is not saved.

While you are in Settings or Images the panels are kept, and an AI answer that is still streaming keeps streaming; coming back, the notes are
read from the database again and merged in.

## Not built yet

Dragging a panel header out of the window to pop it out, and native-menu entries for the panel commands. The to-do panel is the basic version: no due dates, tags, ordering by hand or the other things the Taskfile project has yet. See [panel-system-plan.md](../panel-system-plan.md#build-order).
