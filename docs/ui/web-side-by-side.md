# Web app: notes side by side

Source: [`panes.ts`](../../apps/web/src/components/notes/panes.ts),
[`NoteMenu.tsx`](../../apps/web/src/components/notes/NoteMenu.tsx),
[`PaneArea.tsx`](../../apps/web/src/components/notes/PaneArea.tsx),
[`NotePane.tsx`](../../apps/web/src/components/notes/NotePane.tsx),
[`NotesApp.tsx`](../../apps/web/src/components/notes/NotesApp.tsx) (web and desktop; the terminal app has its own keys, see [cli-keybindings.md](cli-keybindings.md))

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

Each pane has its own tabs: **Markdown** (the editor), **Preview**, and **Split** (both beside each
other, with the divider between them shared by every pane).

- The first note opened starts on **Split**.
- A pane added *beside* another starts on **Markdown**: notes open together are there to be written
  in, and each has only part of the row. Switch that pane to **Split** from its own tabs.
- The other panes keep whatever they were showing, so opening a note beside a pane never changes it.
- A pane narrower than 480px has no Split tab and shows the editor if it was on Split; widening it
  brings Split back.

The arrangement, and each pane's tab, is not saved: a reload starts again with one pane.
The terminal app shares the same pane logic, so a pane it opens with `o` also starts on the editor.

## The AI helper takes room from the note

A pane can open the [AI helper](ai-helper.md) to the right of its note. It sits inside the pane, so it shrinks the note's
own column: the 480px rule above is applied to that column, which means **Split gives way to the Markdown tab sooner**
while the helper is open, and comes back when it closes or the pane widens. Below about 600px the helper covers the note
instead of sitting beside it. Each pane has its own helper, about its own note.

