# Web and desktop: confirming deletes and the Trash Can

Source: [`NotesApp.tsx`](../../apps/web/src/components/notes/NotesApp.tsx),
[`ConfirmDialog.tsx`](../../apps/web/src/components/ConfirmDialog.tsx),
[`TrashCan.tsx`](../../apps/web/src/app/settings/TrashCan.tsx),
[`trashRepo.ts`](../../apps/web/src/lib/composition/trashRepo.ts),
[`trash.ts`](../../apps/web/src/lib/composition/trash.ts)

Nothing is deleted immediately. Deleting a note, group or sub-group asks first, and what
the user confirms goes to the **Trash Can** on the Settings page rather than being erased.

## Confirming a delete

The `×` on a note row and **Delete group** in a group's `⋯` menu don't delete anything;
they open a dialog (`NotesApp` holds one `pendingDelete`, so every delete path goes
through it). The dialog names the item, says it moves to the Trash Can, and repeats that
Trash Can items are permanently deleted after 60 days. **Cancel** has the initial focus, so a
stray `Enter` backs out; `Esc` and clicking outside cancel too.

A group is still only deletable while it has no notes or sub-groups (see
[Deleting a group](../architecture/groups.md#deleting-a-group)), so a trashed group
never has anything hanging off it.

## The Trash Can

Settings ends with a **Trash Can** card: recently deleted notes and groups, each with how
many days are left, **Restore**, and **Delete permanently** (which asks again). The card
always says that items are permanently deleted automatically after 60 days; the window is
`TRASH_RETENTION_DAYS` in `trash.ts`.

| Action | Result |
|---|---|
| Restore a note | Back in its original group, or ungrouped if that group is gone. It re-enters the search index. |
| Restore a group | Back under its original parent, or at the top level if that is gone. |
| Delete permanently | Removed for good. |
| 60 days pass | Removed for good. Expired items are cleared whenever the workspace opens or the Trash Can is loaded. |

Restoring a note whose group is also in the Trash Can puts the note at the top level;
restore the group first to get it back in place. The page says when an item came back at
the top level for this reason.

## Storage

Trashed items live in their own tables, `trashed_notes` and `trashed_groups`
([`db.ts`](../../apps/web/src/lib/composition/db.ts)), keeping their original ids, instead of
being flagged in `notes` and `groups`. The CLI shares the database file and lists every row
of those two tables, so a flag would leave "deleted" notes visible there. As far as the CLI
is concerned a trashed note is simply gone.

The CLI has its own delete confirmation but does not use the Trash Can: deleting in the CLI
still removes the row for good.

Moving to the trash removes the note from the search index; restoring puts it back.
Images pasted into a note are never deleted either way (see
[images.md](../architecture/images.md)).
