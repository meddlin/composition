# Groups

Source: [`storage.py`](../../apps/cli/src/composition/storage.py),
[`screens/main_screen.py`](../../apps/cli/src/composition/screens/main_screen.py),
[`screens/new_group_modal.py`](../../apps/cli/src/composition/screens/new_group_modal.py),
[`screens/select_group_modal.py`](../../apps/cli/src/composition/screens/select_group_modal.py)

Groups let a note be organized under a folder-like name in the UI. A note belongs to
at most one group; groups themselves can nest.

## Relationship

```mermaid
classDiagram
    class Group {
        +int id
        +str name
        +int parent_id
        +str created_at
        +str updated_at
    }
    class Note {
        +int id
        +str title
        +int group_id
    }
    Group "0..1" <-- "many" Group : parent_id (self-reference)
    Group "0..1" <-- "many" Note : group_id
```

- `groups.parent_id` is `NULL` for a top-level group, or another group's `id` for a
  sub-group. Nesting is unbounded.
- `notes.group_id` is `NULL` for an ungrouped note.
- This is **one group per note**, not tag-style many-to-many — a note lives under
  exactly one place in the tree, matching how the UI presents it (top-level group
  names, notes nested underneath).
- Group membership is **database-only**. Unlike `title`/`tags`/`description`, it is
  never written into or read from a note's YAML frontmatter block — see
  [data-model.md](data-model.md).
- There's no DB-level `FOREIGN KEY` constraint (the codebase never turns on
  `PRAGMA foreign_keys`); referential integrity is enforced at the `NotesStore` layer
  instead, consistent with the rest of its hand-rolled style.

## Deleting a group

`NotesStore.delete_group` refuses to delete a group that still has sub-groups or notes
directly in it, raising `GroupNotEmptyError`. There is no cascade and no
auto-promotion of children to a parent — the group must be emptied first. (The web and
desktop apps apply the same rule, but move the emptied group to the Trash Can instead of
erasing it; see [web-trash-can.md](../ui/web-trash-can.md).)
`NotesStore.group_is_empty` is the read-only check `MainScreen` uses to decide whether
to show a warning notification instead of the delete-confirmation modal.

## Rendering as a tree

`MainScreen` renders a Textual `Tree` (`#notes-tree`) instead of a flat list, since
groups nest arbitrarily. `_populate_tree` in
[`main_screen.py`](../../apps/cli/src/composition/screens/main_screen.py):

1. Loads the full group hierarchy via `store.list_groups()` and buckets it by
   `parent_id`, so the entire group structure — including empty groups — is always
   visible and navigable (e.g. right after creating a new one).
2. Buckets the given `notes` list by `group_id` and attaches each note as a leaf under
   its group's node, or under a synthetic "Ungrouped" node (`data={"type": "group",
   "id": None}`) for notes with no group.
3. Tags every node's `data` with `{"type": "group" | "note", "id": ...}` so the
   highlight/select/delete handlers can branch on it.

The same function serves both browse mode (`notes = store.list_notes()`) and search
mode (`notes` = the filtered/matched notes) — search only changes which notes appear
as leaves; the group scaffolding stays stable either way, avoiding a separate
tree-vs-list mode switch.

Every group node is expanded on each rebuild (`expand=True`); collapsed state isn't
persisted across a refresh (a search, a create, a delete), keeping the implementation
simple at the cost of losing manual collapses on the next rebuild.

## Favorites (web and desktop)

The web and desktop sidebar can pin a group or a note to a **Favorites** section above the
tree: "Add to favorites" in the `⋯` menu on a group row or a note row, "Remove from
favorites" from the same menu (also available on the pinned rows themselves). Pinning is a
shortcut, not a move — the item stays where it is in the tree. Favorites appear in the
order they were pinned, and the section is hidden while nothing is pinned.

A pinned group is the same expandable node the tree uses, so its sub-groups and notes can
be browsed from the Favorites section; it starts collapsed. Notes can never be deleted
from the section — pinned notes and notes inside a pinned group have no delete button —
only from the tree below it.

The pinned list (`{ type: "group" | "note", id }[]`, see
[`favorites.ts`](../../apps/web/src/lib/composition/favorites.ts)) lives in the web
settings file next to the column layout, not in the database. The CLI builds its `Note`
and `Group` models straight from `SELECT *` rows, so an extra column would break it. The
trade-off: pins belong to the settings file, so pointing the app at a different database
keeps the same list; entries whose group or note no longer exists are skipped when
rendering, and deleting a pinned note or group removes its entry. The CLI has no favorites.

## Key bindings

| Key | Action |
|---|---|
| `ctrl+g` | New group (`NewGroupModal`), nested under the highlighted group if any |
| `r` | Rename the highlighted group (`RenameGroupModal`), pre-filled with its current name |
| `m` | Move the highlighted note to a different group (`SelectGroupModal`) |
| `ctrl+d` | Delete the highlighted note or (if empty) group |

`r` is a no-op unless a real group node is highlighted — it does nothing on a note leaf
or on the synthetic "Ungrouped" bucket, the same guard `ctrl+d` and `ctrl+g` use for
telling a real group (`data["id"] is not None`) from that pseudo-node.

See [screen-navigation.md](screen-navigation.md) for the full key-binding table.

## Follow-ups (not implemented)

- **Reparenting an existing group in the CLI.** The web app supports it (drag a group
  onto another; see [web-groups.md](../ui/web-groups.md)), with cycle prevention: a
  group can't become its own descendant. `NotesStore` has no equivalent yet.
- **A `group:` search-bar filter token**, mirroring `tag:`. Today, group membership is
  already reflected correctly in the tree during a search (a note only appears under
  its real group), but there's no dedicated syntax to filter the search itself down to
  one group's contents.
