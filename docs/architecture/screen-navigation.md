# Screen navigation

Source: [`app.py`](../../src/composition/app.py),
[`screens/main_screen.py`](../../src/composition/screens/main_screen.py),
[`screens/editor_screen.py`](../../src/composition/screens/editor_screen.py),
[`screens/new_note_modal.py`](../../src/composition/screens/new_note_modal.py),
[`screens/new_group_modal.py`](../../src/composition/screens/new_group_modal.py),
[`screens/rename_group_modal.py`](../../src/composition/screens/rename_group_modal.py),
[`screens/select_group_modal.py`](../../src/composition/screens/select_group_modal.py),
[`screens/delete_note_modal.py`](../../src/composition/screens/delete_note_modal.py)

Composition uses Textual's screen stack (`push_screen`/`pop_screen`) rather than a
static route table. `MainScreen` is the only screen that's ever the base of the stack;
everything else is pushed on top of it and popped or dismissed back off.

## Flow

```mermaid
flowchart TD
    Start(["App starts"]) --> Main["MainScreen<br/>(notes/groups tree + preview)"]

    Main -- "select a note<br/>(Tree.NodeSelected)" --> Editor["EditorScreen<br/>(full-screen editor)"]
    Editor -- "escape<br/>(flush save, pop_screen)" --> Main

    Main -- "ctrl+n<br/>(global, on CompositionApp)" --> NewModal["NewNoteModal"]
    NewModal -- "submit title<br/>(creates note)" --> Editor
    NewModal -- "escape<br/>(dismiss None)" --> Main

    Main -- "ctrl+g<br/>(new group)" --> NewGroupModal["NewGroupModal"]
    NewGroupModal -- "submit name<br/>(creates group)" --> Main
    NewGroupModal -- "escape<br/>(dismiss None)" --> Main

    Main -- "r<br/>(rename highlighted group)" --> RenameGroupModal["RenameGroupModal"]
    RenameGroupModal -- "submit name<br/>(renames group)" --> Main
    RenameGroupModal -- "escape<br/>(dismiss None)" --> Main

    Main -- "m<br/>(move highlighted note)" --> SelectGroupModal["SelectGroupModal"]
    SelectGroupModal -- "select a group<br/>(moves note)" --> Main
    SelectGroupModal -- "escape<br/>(dismiss None)" --> Main

    Main -- "ctrl+d<br/>(delete highlighted note or empty group)" --> DelModal["ConfirmDeleteModal"]
    DelModal -- "y / Delete button<br/>(dismiss True)" --> Main
    DelModal -- "n / escape / Cancel button<br/>(dismiss False)" --> Main
```

Note that `ctrl+n` is bound on `CompositionApp` itself (a global binding), not on
`MainScreen` — it works from anywhere `MainScreen` is the active screen, and pushes
straight to `EditorScreen`, bypassing `MainScreen`'s tree until the user backs out of
the editor and `on_screen_resume` re-syncs it.

## Key bindings

| Scope | Key | Action |
|---|---|---|
| `CompositionApp` (global) | `ctrl+n` | New note → `NewNoteModal`, in the highlighted group |
| `CompositionApp` (global) | `q` | Quit |
| `MainScreen` | `ctrl+d` | Delete the highlighted note, or an empty highlighted group → `ConfirmDeleteModal` |
| `MainScreen` | `ctrl+g` | New group → `NewGroupModal`, nested under the highlighted group |
| `MainScreen` | `r` | Rename the highlighted group → `RenameGroupModal` |
| `MainScreen` | `m` | Move the highlighted note to a different group → `SelectGroupModal` |
| `MainScreen` | `ctrl+space` | Focus the search input |
| `EditorScreen` | `escape` | Flush pending autosave, back to `MainScreen` |
| `NewNoteModal` | `enter` (on title input) | Create note, push `EditorScreen` |
| `NewNoteModal` | `escape` | Cancel, dismiss with `None` |
| `NewGroupModal` | `enter` (on name input) | Create group, dismiss with the new `Group` |
| `NewGroupModal` | `escape` | Cancel, dismiss with `None` |
| `RenameGroupModal` | `enter` (on name input, pre-filled) | Rename group, dismiss with the updated `Group` |
| `RenameGroupModal` | `escape` | Cancel, dismiss with `None` |
| `SelectGroupModal` | `enter` (on a group) | Move the note there, dismiss with `GroupSelection` |
| `SelectGroupModal` | `escape` | Cancel, dismiss with `None` |
| `ConfirmDeleteModal` | `y` / Delete button | Confirm, dismiss `True` |
| `ConfirmDeleteModal` | `n` / `escape` / Cancel button | Cancel, dismiss `False` |

`MainScreen` sets `AUTO_FOCUS = "#notes-tree"` instead of Textual's default (which
would focus the search `Input` first, since it's composed before the tree). If the
search input had default focus, its own built-in `ctrl+d` binding (delete-char-right)
would shadow the screen's delete action before the user ever typed anything.

## Returning to `MainScreen`

`MainScreen.on_screen_resume` fires every time a pushed screen is popped back to it
(returning from the editor, or a modal dismissing). It re-runs the active search query
if the search box has text, otherwise reloads the full notes/groups tree — so edits
made in `EditorScreen` (title changes, deletions) are always reflected immediately.
