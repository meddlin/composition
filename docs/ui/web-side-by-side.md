# Web app: notes side by side

Source: [`panes.ts`](../../apps/web/src/components/notes/panes.ts),
[`NoteMenu.tsx`](../../apps/web/src/components/notes/NoteMenu.tsx),
[`PaneArea.tsx`](../../apps/web/src/components/notes/PaneArea.tsx),
[`NotePane.tsx`](../../apps/web/src/components/notes/NotePane.tsx),
[`NotesApp.tsx`](../../apps/web/src/components/notes/NotesApp.tsx) (web and desktop; the terminal app has its own keys, see [cli-keybindings.md](cli-keybindings.md))

**The desktop app no longer works this way:** it shows its open notes in a grid of panels, described in [panels.md](panels.md). What follows is the web app's row of panes.

The workspace shows its open notes in a single row of panes. Each note is open in at most one pane,
and the pane that was last clicked or typed in is the *focused* one: it is where a note picked in
the sidebar opens, replacing the note that was there.

## Opening a note beside another

| How | Result |
|---|---|
| **`⋯` → Open to the side** on a note row (also in the Favorites section) | The note gets a new pane to the right of the focused one, which gives up half its width. |
| Drag a note from the sidebar to the left or right edge of a pane | The same, on the side you dropped it. |
| `Cmd/Ctrl`-click a note link in a preview | The same, to the right of the pane the link is in. |

A note that is already open is not opened twice: it moves next to the focused pane (or the pane it
was dropped on), and keeps its view. With nothing open, "Open to the side" just opens the note.

There is no right-click menu on a note row. The `⋯` button is where per-note actions live, it works
from the keyboard, and the same menu also holds pinning.

## What a pane shows

Each pane has its own tabs: **Live** (the editor and the preview in one place: the Markdown drawn as it will read, with
its syntax showing only under the caret; see [live-editor.md](live-editor.md)), **Markdown** (the editor), **Preview**
and **Split** (both beside each other, with the divider between them shared by every pane). Ctrl/Cmd+\ steps through
them in that order.

In Split the two halves stay at the same place in the note: scrolling either one scrolls the other to the matching spot.
They are matched by where each half's top is in the note's text, not by how far down each is scrolled, because pictures,
tables and components are much taller in the preview than in the editor. The side being scrolled by hand (wheel,
trackpad, scrollbar, keys) leads; otherwise the editor does, so the preview keeps up with typing and with find. At the
very top or bottom of one, the other goes to its top or bottom too. (`useSplitScrollSync`; the iPad does the same.)

- The first note opened starts on the view chosen in **Settings › Writing › Open notes in** (Live unless changed).
- A pane added *beside* another starts on that view too, except Split: then it starts on **Markdown**, as notes open
  together are there to be written in, and each has only part of the row. Switch that pane to **Split** from its own tabs.
- The other panes keep whatever they were showing, so opening a note beside a pane never changes it.
- A pane narrower than 480px has no Split tab and shows the editor if it was on Split; widening it
  brings Split back.

The arrangement, and each pane's tab, is not saved: a reload starts again with one pane. In the desktop app the open panes (and the AI helper's chats) are kept while you are in Settings or Images, and are
there when you come back; the web app, which loads the page afresh, starts again with one pane.
The terminal app shares the same pane logic but has no Live tab: it opens notes in Split, so a pane it opens with `o`
starts on the editor.

## The AI helper takes room from the note

A pane can open the [AI helper](ai-helper.md) to the right of its note. It sits inside the pane, so it shrinks the note's
own column: the 480px rule above is applied to that column, which means **Split gives way to the Markdown tab sooner**
while the helper is open, and comes back when it closes or the pane widens. Below about 600px the helper covers the note
instead of sitting beside it. Each pane has its own helper, about its own note. (In the desktop app's [panels](panels.md#the-ai-helper-as-a-panel) the helper is a panel of its own, not a dock.)

