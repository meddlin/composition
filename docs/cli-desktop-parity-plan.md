# CLI / desktop parity plan

Written 2026-10-17. Goal: the terminal app does everything the desktop app does, except where a
terminal makes it impossible. See [feature-matrix.md](feature-matrix.md) for the current state.

## Baseline

The CLI was last brought level with the desktop on **2026-10-02** (`313b9ce` MDX and images in the
preview, `14e4976` code highlighting, `880291a` backup and restore). Since then it has only taken
the Wine color scheme (`67602d9`, 10-12) and a test touch-up for search hits (`3d3a394`, 10-14).

The CLI reaches the shared data layer through [`backend.ts`](../apps/cli/src/backend.ts), so most of
what is missing already exists as a service function. The work is mostly UI: keys, a panel, tests.

## What changed since, and what the CLI can do about it

| Desktop change | Commit | In the CLI today | Verdict | Plan |
|---|---|---|---|---|
| Rearrange notes and groups by drag-and-drop | `dc78f04` | Notes follow the stored `position`; groups are always sorted by name (`tree.ts:75,178`); no way to reorder | **Can match**, with keys instead of a mouse | Phase 2 |
| Attach any file to a note, table on the note; limit raised to 1 GB | `f5f0faf`, `fa7cfa3` | Nothing. The data is kept safe in backups and "move data" | **Can match**: attach by typed path, list, save a copy, remove. No "show in Finder" (see Decisions) | Phase 3 |
| Paste images into notes; no size limit on desktop | `8037c0f`, `9d8606f` | Draws images; cannot add one | **Partly**: a terminal cannot receive image bytes from a paste. It can import an image *file* | Phase 4 |
| Resizable, remembered columns | `1a0f1b9` | Sidebar fixed at 34 columns (`App.tsx:15`); pane sizes not saved | **Can match** with keys (mouse drag optional) | Phase 5 |
| Tab types a tab in the editor | `0b6a640` | Unknown; `Pane.tsx` binds only undo and redo | **Can match**, probably one key binding | Phase 1 |
| Markdown syntax highlighting while writing | `63e1a47` | **Already done** (`highlight.ts`, `Pane.tsx`) | The matrix row is stale | Phase 1 (docs) |
| Group and sub-group in search results | `3d3a394` | The tree keeps a hit's ancestor groups, so the path is already visible | Already satisfied | none |
| Cmd/Ctrl+K focuses search | `2bc1488` | `/` and `ctrl+space` | Already satisfied (`ctrl+k` is the editor's, so not added) | none |
| Wine color scheme | `67602d9` | Done | Done | none |
| Over-the-air updates, friendlier errors, pre-release toggle | `e4f5369`, `4d10b3f` | n/a | **Not applicable yet**: the CLI has no distribution channel (feature matrix: "Undecided"). Revisit when it ships. Stays 🚫 | none |
| Bundled Meilisearch | earlier | Uses an installed `meilisearch` | **Cannot** be bundled in a source-run CLI. Stays ❌ | none |
| Release workflow, signing, opengrep, `/docs` viewer | various | n/a | Desktop packaging or repo tooling, not user features | none |

So 5 features to build (reorder, attachments, image import, column sizes, Tab), and 1 docs fix.

## Phases

Each phase is one pull request, and updates `keymap.ts` (the single list the footer, `?` overlay and
handlers read), [cli-keybindings.md](ui/cli-keybindings.md), the feature matrix row and the
architecture doc it touches, in the same change. `App.tsx` is shared by all of them, so build them
in order rather than in parallel.

### Phase 1: housekeeping and Tab (done 2026-10-17)

- Correct the matrix: CLI syntax highlighting while writing is ✅; the reorder row stays ❌ until Phase 2.
- Make Tab insert a tab in the editor, with Shift+Tab left alone so focus can still leave. First check
  what OpenTUI's `<textarea>` does with Tab today; if it already inserts, only add the test.
- Done when: a test types Tab into an open note and the text holds a tab.
- Result: the textarea swallowed Tab (it typed nothing). `Pane.tsx` now turns a bare Tab into `insertText("\t")`
  from `onKeyDown`; plain typing and Tab replace a selection alike. There is no focus-moving Tab in the CLI
  (`Esc` leaves the editor), so Shift+Tab is simply unbound.

### Phase 2: reorder with the keyboard (done 2026-10-17)

- Keys in the tree scope to move the highlighted note or group up or down among its siblings
  (proposal: `shift+↑` / `shift+↓`; rule 4 in the keybindings doc forbids only `ctrl`/`alt` arrows).
  Check the terminal can tell `shift+↑` from `↑` first; fall back to `J`/`K` if not.
- Call `service.placeNote` / `service.placeGroup` (insert before a sibling, or last), then reload the workspace.
- `buildTree` must sort sibling groups with the same rule as the data layer (hand-placed by
  `position` first, then by name), instead of always by name. Reuse `ordering.ts`'s `placeBefore`.
- Keep the cursor on the moved row (rows already have stable keys).
- Result: `shift+↑`/`shift+↓` (the list widget also reads them, so the handler calls `preventDefault`). Reordering is
  refused while a search narrows the tree and in Favorites. `buildTree` and `orderedGroups` now keep the data
  layer's sibling order instead of re-sorting by name; `Group` carries no `position`, the SQL order is the order.
  Not yet checked in a real Terminal.app/iTerm window: the tests send the keys through OpenTUI's own parser.
- Done when: reorder in the CLI shows the same order in the desktop app after a reload, and the reverse.
  Update [groups.md](architecture/groups.md#ordering): remove "the terminal app can't reorder yet".

### Phase 3: attachments (done 2026-10-17)

- An **Attachments** panel for the open note, below the editor in the pane: a table of name, size,
  added. Focus it with a new key (free keys: `ctrl+p`, `ctrl+r`, `ctrl+s`, `ctrl+l`; proposal `ctrl+p`, "paperclip").
- Actions: attach (type a path; several allowed, separated by newlines, and a path pasted from a
  dragged-in file works), save a copy to a typed path, remove (with the usual `y` confirm).
- Use `service.listAttachments`, `addAttachmentFiles`, `findAttachmentFile`, `removeAttachment`. The
  1 GB limit and name safety are already in `attachmentNames.ts`; show the same per-file error text
  the desktop shows, and still attach the other files.
- Same security stance as desktop: never "open" an attachment (it could run a script).
- Result, with one change from the plan: an **Attachments screen** (like the Trash Can's) instead of a panel
  inside the pane, which would have cost editor height in a short terminal. `a` on a note in the tree, or
  `ctrl+p` in its pane; there `a` attaches, `s` saves a copy, `ctrl+d` removes. Paths are read like a shell
  reads them, so files dragged into the terminal work. A note's attachment count is not shown in its
  pane title yet, so a note with files looks like one without until the screen is opened.
- Done when: a file attached in the CLI appears in the desktop table, and the reverse; moving a note
  to the Trash Can and back keeps its attachments (that part is the data layer's, unchanged).

### Phase 4: add images from the terminal (done 2026-10-17)

A terminal cannot paste image bytes, so parity here means "get an image into a note some other way":

1. **Insert image from a path** (a dialog like New group). It calls `service.saveImage` and inserts
   the `![](app_data/…)` reference at the cursor. Always available.
2. **Paste or drag a file path into the editor**: if the pasted text is a single existing image
   file, import it instead of inserting the path. Needs a spike on OpenTUI's paste event.
3. Stretch: read the system clipboard (`osascript`, `wl-paste`, `xclip`) behind a key. Platform
   specific, so only if 1 and 2 feel too clumsy.

Image size: follow the desktop (no limit) by calling `service.setMaxImageBytes(null)` at startup, as
the desktop main process does.

Result: steps 1 and 2 are done (`ctrl+l`; pasting image paths, which is also what dragging a file into
the terminal does), the limit is lifted in `main.tsx`, and step 3 (clipboard) is left out as decided.
The size-limit call is in the entry point, which tests don't run, so nothing checks it automatically.

### Phase 5: remembered column sizes

- Keys to widen or narrow the sidebar, and to change the editor/preview split in a pane; keep
  `SIDEBAR_WIDTH` as the default, not a constant. Mouse drag on the divider as a follow-up.
- Persist through `service.saveLayout`.
- Open question (below): the shared layout stores **pixels**, the CLI draws **columns**.

## Decisions

Settled 2026-10-17: 1 is (b), a CLI-only setting; 2 and 3 take the recommendations.

1. **Where do column sizes live?** (a) Convert the shared pixel values to columns, so one layout
   follows you across apps but each resize in the CLI moves the desktop's columns too; or (b) a
   separate CLI-only setting (`sidebarColumns`), so the apps never disturb each other. Recommend **(b)**.
   It needs the backup format to carry the new field, which `backup.ts` shares with the other apps.
2. **Image import: how far to go?** Recommend steps 1 and 2 above, and no clipboard code in v1.
3. **Reveal an attachment?** Desktop has "show in Finder". The CLI could print the stored path in the
   status line instead. Recommend that, and no `open`/`xdg-open`.

## Not verified yet

This worktree has no `apps/cli/node_modules`, so I did not read OpenTUI's source. Three things need
a short spike at the start of the phase that depends on them: what `<textarea>` does with Tab
(Phase 1), whether `shift+↑`/`shift+↓` arrive as distinct keys (Phase 2), and what the paste event
carries (Phase 4).
