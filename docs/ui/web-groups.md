# Web app: managing groups

Source: [`GroupTree.tsx`](../../apps/web/src/components/notes/GroupTree.tsx),
[`GroupMenu.tsx`](../../apps/web/src/components/notes/GroupMenu.tsx),
[`GroupPage.tsx`](../../apps/web/src/components/notes/GroupPage.tsx),
[`NotesApp.tsx`](../../apps/web/src/components/notes/NotesApp.tsx)

How the web app lets a user create, rename and delete groups. The data model is in
[groups.md](../architecture/groups.md); this page covers the UI.

## Design principle

The left-hand navigator is for **getting around**; the group page is for **managing a
group**. Every group row in the navigator would otherwise accumulate buttons, so the
row stays light and the less frequent actions are tucked behind one menu.

## Navigator group row

Left to right: expand/collapse chevron, folder icon, group name, `+ note`, `⋯`.

| Interaction | Result |
|---|---|
| Click the name | Opens the group page (replaces the editor). |
| Click the chevron | Expands or collapses the group. |
| **Double-click the row** | Renames the group inline. |
| `+ note` | Creates a note directly in this group. |
| `⋯` | Opens the group's action menu (below). |
| Drop a dragged note on the row | Moves the note into the group. |
| Drag the row onto another group | Nests it inside that group, sub-groups and notes included. |

`+ note` and `⋯` appear on hover, and whenever they have keyboard focus or the menu is
open.

### Nesting groups by drag-and-drop

Drag a group row onto another group to make it a sub-group. While a group is being
dragged:

- Rows that would be invalid targets — the group itself and everything beneath it, or
  its current parent — don't highlight and show the browser's "not allowed" cursor.
  A group can never end up inside its own descendants; the server re-checks this
  ([`groupMove.ts`](../../apps/web/src/lib/composition/groupMove.ts)) and refuses the
  move if another tab changed the tree in the meantime.
- If the group is nested, a **Drop here to move to top level** strip appears above the
  tree; dropping on it makes the group top-level again.

The move is optimistic, like renaming: the tree updates immediately and rolls back,
with an error under the tree, if the server refuses. A group's notes and sub-groups
travel with it, since they reference it by id. The destination stays collapsed if it
was collapsed, so expand it to see the moved group.

### The `⋯` menu

| Item | Result |
|---|---|
| Rename | Same inline rename as double-click. |
| New sub-group | Expands the group and shows an inline name field beneath it. |
| Delete group | Asks for confirmation, then moves the group to the Trash Can (see [web-trash-can.md](web-trash-can.md)). Disabled unless the group has no notes and no sub-groups (see [Deleting a group](../architecture/groups.md#deleting-a-group)). |

Keyboard: `Enter`/`Space` on `⋯` opens the menu and focuses the first item; `↑`/`↓`
move between items; `Esc` closes it and returns focus to `⋯`; clicking elsewhere,
scrolling or resizing also closes it. The menu is positioned with `position: fixed`
so the sidebar's scroll area cannot clip it, and opens upward near the bottom of the
window.

### Inline rename field

Used by double-click, the menu, and the group page. `Enter` or clicking away saves;
`Esc` cancels. A blank name is ignored. Renaming is optimistic: the name changes in the
UI immediately and is reconciled with the server's copy when the save returns.

## Group page

Clicking a group opens a read-only overview: a breadcrumb of ancestor groups, the
title, a note and sub-group count, and a nested listing of everything beneath it.

**Renaming from the page.** A `Rename` button sits beside the title. It swaps the title
for the inline field, pre-filled and selected. `Enter` or blur saves, `Esc` cancels, and
a blank or unchanged name does nothing. This works identically for a top-level group and
a sub-group, because each sub-group has its own page (click it in the listing). The
navigator updates at once because the page and navigator read the same state.

## Docs page

`Docs`, above `Settings` at the bottom of the navigator, opens `/docs`: the Markdown
files in this repository's top-level [`docs/`](../index.md) directory, rendered in the
web app. Its own left rail lists every doc (titled from its first `# heading`); relative
links between docs work, while links into the source tree are shown as plain text.

Docs are read from disk on each request, so editing a file under `docs/` shows up on
refresh. The directory defaults to `../../docs` relative to `apps/web`; set
`COMPOSITION_DOCS_DIR` to point elsewhere. Only files found by scanning that directory
can be opened, so a crafted URL cannot read other files.

Source: [`lib/composition/docs.ts`](../../apps/web/src/lib/composition/docs.ts),
[`app/docs/[[...slug]]/page.tsx`](../../apps/web/src/app/docs/%5B%5B...slug%5D%5D/page.tsx)

## Ideas not built

- **`F2` to rename** the group whose row or page is focused.
- **Right-click** on a group row to open the same menu as `⋯`.
- Moving "New sub-group" and "Delete" onto the group page too, which would let the
  menu shrink further.
