# CLI: keybindings

Status: **agreed 2026-10-02 for the TypeScript CLI** (OpenTUI on Node 26). The CLI
described here is being built on branch `claude/cli-typescript-port-2f440f`; until it
lands, the Python CLI still uses the older subset marked *(existing)* below.

This page is the one place the CLI's keys are written down. The footer and the `?`
help overlay show the live bindings (the footer drops its later hints in a narrow terminal, but
never help, quit or the way back; the overlay scrolls in a short one); if they ever disagree with this page, the code
wins and this page needs updating in the same pull request.

## Rules

1. **Keys inside the editor always win.** A key the text editor already uses is never
   taken for an app action while the editor has focus (see
   [Editor-owned keys](#editor-owned-keys)).
2. **`Esc` always gets you back to the tree.** From any pane, one key.
3. **Plain letters are only app actions while the tree has focus.** In an editor they
   type.
4. **No digits, no arrows with `ctrl` or `alt`.** The operating system or the editor
   takes them (see [Keys we cannot use](#keys-we-cannot-use)).

## Anywhere the tree has focus

| Key | Action | |
|---|---|---|
| `↑` `↓` | Move through the tree | *(existing)* |
| `←` `→` | Collapse / expand a group | *(existing)* |
| `Enter` | On a note: open it in the focused pane (or focus the pane it is already in). On a group: fold or unfold it. On "Settings" or "Trash": open that screen | *(existing, now opens a pane)* |
| `o` | Open the note in a **new pane to the right** | new |
| `ctrl+n` | New note (in the highlighted group) | *(existing)* |
| `ctrl+g` | New group (inside the highlighted group) | *(existing)* |
| `r` | Rename the highlighted group | *(existing)* |
| `m` | Move the highlighted **note or group** to another group | note: *(existing)*; group: new |
| `f` | Pin / unpin the highlighted note or group as a favorite | new |
| `ctrl+d` | Delete the highlighted note or group. A note goes to the Trash Can, after a confirmation | *(existing, now goes to Trash)* |
| `/` or `ctrl+space` | Focus the search bar | `ctrl+space` *(existing)*, `/` new |
| `t` | Open the Trash Can (the same as pressing Enter on the "Trash" row) | new |
| `ctrl+o` | Go to the first pane | new |
| `q` | Quit (saves any edit still waiting first) | *(existing)* |

Search syntax is shared with web and desktop: `tag:`, `title:`, `description:`,
`created:` / `createdOn:`, `updated:` (see [search.md](../architecture/search.md)).

## While a pane has focus

| Key | Action |
|---|---|
| `Esc` | Back to the tree |
| `ctrl+o` | Next pane. The order is tree, pane 1, pane 2, …, then back to the tree. Mnemonic: Emacs's "other window" |
| `ctrl+t` | Cycle the pane's view: editor, split (editor and preview side by side), preview. Mnemonic: toggle view |
| `ctrl+x` | Close the pane |
| `ctrl+n` | New note (works here as well as in the tree, as it did in the Python CLI) |
| everything else | Editing (see below) |

Each note is open in at most one pane, panes sit in a single row, and the arrangement is
not saved between runs, the same as web and desktop.

## Search bar

Reached with `/` or `ctrl+space` from the tree. Everything you type goes into the bar, so
`q`, `o` and the other command letters are just letters here.

| Key | Action |
|---|---|
| any text | Search after a short pause (350 ms); the tree shows only the matching notes, and drops groups with nothing in them |
| `Enter`, `↓` or `Esc` | Back to the tree, keeping the search |
| `ctrl+u` | Clear the bar, which brings the whole tree back |

## Trash screen

Opened with `t` in the tree, or with Enter on the "Trash" row beside "Settings" at the bottom of
the tree. It lists everything deleted in the last 60 days, notes and groups together, the most
recently deleted first, with how many days each has left.

| Key | Action |
|---|---|
| `↑` `↓` | Move |
| `r` | Restore the note or group |
| `ctrl+d` | Delete it for good, after a confirmation |
| `Esc` | Back |

Items are kept 60 days and cleared at startup after that. Restoring a note puts it back in its
group, or at the top level (and says so) if the group has been deleted since.

## Settings screen

Not specified in the 2026-10-02 agreement beyond `Esc`; the rest are the natural form
controls and will be confirmed when the screen is built.

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move between fields |
| `Enter` | Save the data location or the city |
| `↑` `↓` | Choose a color scheme |
| `Esc` | Back *(existing)* |

## Dialogs

| Dialog | Keys |
|---|---|
| New note, new group, rename group | type a name, `Enter` to confirm, `Esc` to cancel *(existing)* |
| Move to a group | `↑` `↓` to choose, `Enter` to move, `Esc` to cancel *(existing)* |
| Confirm delete | `y` to confirm; `n` or `Esc` to cancel *(existing)* |

## Editor-owned keys

These belong to the text editor (OpenTUI's `Textarea`) and are not available to the app
while an editor has focus. Most are its defaults; the two marked ★ are our remapping.

| Keys | What they do |
|---|---|
| `←` `→` `↑` `↓` | Move the cursor |
| `ctrl+←` `ctrl+→`, `alt+←` `alt+→`, `alt+b` `alt+f` | Move by word |
| `ctrl+a` `ctrl+e` | Start / end of line |
| `alt+a` `alt+e` | Start / end of the wrapped (visual) line |
| `ctrl+f` `ctrl+b` | Cursor right / left |
| `ctrl+w`, `ctrl+Backspace`, `alt+Backspace` | Delete the word before the cursor |
| `alt+d`, `ctrl+Delete`, `alt+Delete` | Delete the word after the cursor |
| `ctrl+k` `ctrl+u` | Delete to end / start of line |
| `ctrl+d` | Delete the character under the cursor (so `ctrl+d` is *not* "delete note" here) |
| `ctrl+shift+d` | Delete the line |
| `Shift` + any movement key | Extend the selection |
| `ctrl+z` ★ | Undo (OpenTUI's default is `ctrl+-`) |
| `ctrl+y` ★ | Redo (OpenTUI's default is `ctrl+.`) |

Undo goes one keystroke at a time.

## Keys we cannot use

Found while building the spike on 2026-10-02; the reason matters more than the list.

| Key | Why it is off limits |
|---|---|
| `ctrl+←` `ctrl+→` | macOS Mission Control switches virtual desktops with them. The terminal never receives the key. Confirmed on the maintainer's machine. Also the editor's word-move keys |
| `alt+←` `alt+→` | The editor's word-move keys. Terminal.app also sends them as `alt+b` / `alt+f` |
| `ctrl+e` | The editor's end-of-line key, so it can't be "cycle view" |
| `ctrl+1` … `ctrl+9`, `alt+1` … `alt+9` | Mission Control uses `ctrl+digit` to switch desktops, and `alt+digit` types symbols (`¡ ™ £`) in Terminal.app by default |
| `ctrl+shift+<letter>` | A legacy terminal cannot tell it from `ctrl+<letter>`, so there is no "previous pane" key |
| `ctrl+c` | Quits the app (OpenTUI's `exitOnCtrlC`) |

Before adding a binding, check this table and the editor-owned table above. Keys that
are free inside the editor today: `ctrl+x`, `ctrl+t`, `ctrl+o`, `ctrl+g`, `ctrl+n`,
`ctrl+p`, `ctrl+r`, `ctrl+s`, `ctrl+l`, `ctrl+space`.

## Where this is defined

The bindings will live in one module in `apps/cli`, so the footer, the `?` overlay and
the handlers all read the same list. Editing this page without changing that module (or
the reverse) is a bug.
