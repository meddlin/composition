# Markdown files and git: research

Can notes live on disk as Markdown files (instead of, or mirrored beside, the SQLite database) so
that users can track them with git? Researched 2026-10-17 against this repo's source and first-party
docs and source of the tools involved. Repo facts are cited as `file:line`; external facts carry a
bracketed source number (see [Sources](#sources)); anything marked **Inference** is my reasoning
from those facts, not something a source states. Nothing here was prototyped or benchmarked.

SQLite stays in every option below. The question is only whether a folder of `.md` files exists
beside it, and who is the source of truth.

## Short answers

**Is it feasible?** Yes, and the repo is better placed for it than most. Two facts do most of the
work:

1. A note's `content` column already *is* a Markdown file with YAML frontmatter (`title`,
   `description`, `tags`, `createdAt`, `updatedAt`) (`frontmatter.ts:92-104`,
   `docs/architecture/data-model.md`). Writing `content` verbatim to `<name>.md` loses none of
   the text or those five fields.
2. Every write from the web, desktop and CLI apps goes through one module, `service.ts`; the repos
   are never called from a UI. One hook point covers all three apps. The only direct writer I found
   outside it is the dev seeding tool (`apps/cli/src/tools/seedNotes.ts:13`).

**What does not come along in a plain `.md` file:** the note id, its group, the group tree itself
(including empty groups), manual ordering, trash state, attachments, and favorites. These are
database-only or settings-only today, some by documented design. Any option must put them
somewhere else (a manifest file, folders, extra frontmatter keys); see
[What does not round-trip](#what-does-not-round-trip-through-md--frontmatter).

**Why git on the data dir is poor today:** the notes are one binary file whose newest committed
transactions can sit in a separate `-wal` file that a plain `git add` of `composition.db` will not
capture; git can show only "Binary files differ", cannot merge it, and the same folder holds a
secret (`meili_master_key`) and gigabytes of derived or binary data.

**Recommended path** (detail in [Recommended path](#recommended-path)):

1. **Step 1, a write-only mirror (option A).** Project DB to a folder of `.md` files (groups as
   folders, `slug--id.md` names, a small manifest for ids and order), refusing to overwrite files
   that changed on disk. Cheap, safe, and already gives users history, readable diffs and a remote
   backup, for a single machine.
2. **Step 2, a manual "Import changes from files" action (the cheap half of option C).** No
   watcher, no UI push plumbing.
3. **Step 3, live two-way sync (full option C)**, only if wanted. This is where the real cost is
   (watchers, a change channel to the UIs, conflict handling in the editor, an API change).
4. **Multi-device sync through git is a separate decision** that needs globally unique note ids.
   Integer `AUTOINCREMENT` ids collide across machines. Do not promise it with steps 1 or 2.

**Not recommended now: option B (files as source of truth, SQLite as a rebuildable index).** It is
what Obsidian's model looks like [24], but here it means re-deriving ids, groups, ordering, trash
and attachments from files, and it turns single-row SQL transactions into multi-file writes. It
also contradicts the stated architecture ("SQLite is the source of truth", `docs/architecture/search.md`).

**What git would and would not give users:** it would give history, diffs, blame, and an off-machine
backup. It would not give merge-free multi-device sync, an in-app "restore this version" (unless
built), or protection from pushing plaintext notes to a remote.

## Current state

### Where data lives

All three apps open `<application data>/composition.db` (default `~/.composition`) through the same
data layer (`docs/product-builds.md`). The pieces:

| What | Where | Source |
|---|---|---|
| Notes | `notes` table; `content` holds the full text with frontmatter | `db.ts:6-15`, `notesRepo.ts` |
| Groups | `groups` table; self-referencing `parent_id`; no foreign keys, no uniqueness on names or titles | `db.ts:17-25`, `docs/architecture/groups.md` |
| Order | nullable `position` on both tables; `NULL` means "default order" (notes by `updated_at DESC`, groups by name) | `notesRepo.ts:49`, `groupsRepo.ts:40` |
| Trash | separate `trashed_notes` / `trashed_groups` tables with `deleted_at`, 60-day retention; note ids kept | `db.ts:27-48`, `trashRepo.ts` |
| Images | files in `app_data/`, named `<title-slug>-<file-slug>-<12 hex of SHA-256>.<ext>`; the note's Markdown refers to `app_data/<name>` relative to the data dir | `images.ts:36-52`, `imageRefs.ts:12,29` |
| Attachments (desktop only) | `attachments/<12 hex>-<safe name>` files plus an `attachments` table (`note_id`, `file_name`, `stored_name`, `size`, `created_at`); up to 1 GB each; deliberately not in frontmatter | `db.ts:50-60`, `attachmentNames.ts`, `docs/architecture/attachments.md` |
| Favorites, theme, layout | a per-app settings JSON file, outside the data dir; favorites are `{type, id}` pairs | `webSettings.ts:16,27-37`, `docs/architecture/groups.md` |
| Search index | Meilisearch, one per product, derived from SQLite and rebuildable | `searchIndex.ts:10-16`, `docs/architecture/search.md` |

Observed on the owner's machine at research time (sizes only): `composition.db` 48K, `-wal` 260K,
`-shm` 32K, `app_data/` 2.3M, `meili_data/` 2.9M, plus `meili.log`, `meili_master_key` and a legacy
`settings.yaml`. **Inference:** a WAL larger than the main file means recent committed changes live
in the WAL, not yet in `composition.db`. That is normal for WAL mode [1], but it is exactly what a
naive "commit the .db file" misses.

### Frontmatter, in detail

- `FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/`, anchored at the very start
  (`frontmatter.ts:12`). It accepts CRLF. **I ran it against a string starting with a UTF-8 BOM and
  it does not match**, so a BOM-prefixed file parses as "no frontmatter" (the save then falls back
  to the raw-content path). Jekyll documents the same BOM hazard for front matter [21].
- `parse` extracts exactly five keys; `render`/`serialize` write exactly those five, in fixed order
  (`frontmatter.ts:40-64,66-69,92-104`). **Anything else in the block is dropped on the next save**
  through the app (`service.saveNoteContent`, `service.ts:161-189`): unknown keys, comments, and
  the original formatting. `attachments.md` records the same limitation as a reason attachments are
  not in frontmatter.
- `notesRepo.updateNote` writes `content, title, tags, description, updated_at` but **not
  `created_at`** (`notesRepo.ts:95-107`). So today the `createdAt` in `content` and the `created_at`
  column (which feeds search's `created_at_ts`, `searchIndex.ts:88-98`) can diverge if a user edits
  `createdAt` by hand. Any file-based design has to pick which one wins.
- Tags are a YAML list in the file but a comma-joined string in the column
  (`frontmatter.ts:77-91`); a tag containing a comma would split in the column.
- `updatedAt` is set to "now" on every autosave (`service.ts:175`), so every edit changes that line.
- Timestamps are written as quoted ISO strings. Unquoted ISO timestamps are YAML 1.1 `timestamp`
  values [23]; `asString` already turns a parsed `Date` back into a string (`frontmatter.ts:107-112`).

### Who writes, and from how many processes

- **Funnel:** web Server Actions (`actions.ts`) and desktop IPC (`apps/desktop/src/main/ipc.ts`,
  `validate.ts`) both call `service.ts`; the CLI imports it through `apps/cli/src/backend.ts`. Desktop
  and CLI reach it through one seam file each (`docs/shared-core-plan.md`).
- **Concurrency:** WAL is switched on at open (`db.ts:81`) so the terminal, web and desktop apps can
  share one database; the desktop app holds a single-instance lock (`apps/desktop/src/main/index.ts:139`),
  but a CLI and a web server can run beside it (`docs/product-builds.md`, "What sharing costs right now").
  SQLite WAL requires all processes to be on one host [1].
- **No change feed exists.** I found no file watcher, polling or push channel in `apps/*/src`
  (only two unrelated `setInterval` timers for the sun theme). The web page loads the workspace on
  render (`apps/web/src/app/page.tsx:10`); the desktop app loads it over IPC; the CLI loads once and
  reloads after a restore or data move (`apps/cli/src/App.tsx:553`). Today an edit made by another
  app is not seen until the next load.
- **Search:** each product has its own Meilisearch index; `indexNote` runs after create, save and
  restore, `deleteNoteFromIndex` after delete, and a full `reindexAll` runs at startup and after a
  restore (`service.ts:187,226,236,405`, `searchIndex.ts:123-141`, `apps/desktop/src/main/search.ts:101-120`).
  Indexing is best effort and never fails a write (`service.ts:59-65`). Meilisearch databases open
  only with the version that created them [34], another reason to treat that directory as disposable.
- **Backup/restore:** one `.tar.gz` containing a `VACUUM INTO` snapshot of the database, `settings.json`,
  `app_data/` and `attachments/`; restore stages, checks `PRAGMA quick_check`, saves a pre-restore
  backup, swaps, then rebuilds the index (`backup.ts:22,114,167`, `service.ts:361-409`,
  `docs/architecture/backup-restore.md`). `VACUUM INTO` is one of the safe ways to copy a live
  database [2].
- **Import/export:** none besides Backup/Restore. I found no Markdown export or import in `docs/` or
  `apps/*/src`.

## Why git on the data directory is poor today

| Problem | Why | Source |
|---|---|---|
| A single binary file | SQLite files begin with `SQLite format 3\0` and are fixed-size pages [4]; git's default is "Binary files differ" for such content unless a textconv is configured [7]. | [4], [7] |
| Newest data may not be in the `.db` | WAL mode keeps committed transactions in `<db>-wal` until a checkpoint; the WAL "should be kept with the database", and "if a database file is separated from its WAL file ... transactions that were previously committed ... might be lost, or the database file might become corrupted" [1]. A checkpoint also runs when the last connection closes [1]. | [1], [3] |
| Copying a live DB is unsafe | A copy taken mid-transaction can be corrupt; the SQLite-recommended ways are `VACUUM INTO`, the backup API, or `sqlite3_rsync` [2]. A `git add` is a plain file copy. | [2] |
| Side files appear and vanish | `-wal`, `-shm` and `-journal` come and go with connections and crashes [3]. Restoring a commit that contains a stale `-wal` next to a different `.db` is the "mispairing" case SQLite warns about [2]. | [2], [3] |
| No merge | Git has line-based text merging, or a custom driver [7]; for a SQLite file there is nothing to merge. Logseq's DB-mode answer to "can I use Git" is that Git users must stay on its plain-text modes [31]. | [7], [31] |
| History bloat | A tiny change touches pages across the file; git stores a changed blob in full as a loose object and only deltas against it when packed [8]. **Inference:** at this size (tens of KB) that is harmless, but diffs are still unreadable. | [8] |
| Derived and secret data in the same folder | `meili_data/` (rebuildable, and only valid for one Meilisearch version [34]), `meili.log`, `dumps/`, and `meili_master_key`, a credential (`searchIndex.ts:31-41`, `apps/desktop/src/main/search.ts:86`). `git add .` in `~/.composition` would commit the key. | [34] |
| Images and attachments | Binary, never deleted by the app (`docs/architecture/images.md`, "Gaps"); attachments up to 1 GB. | repo |

A middle path that needs no new storage format is `sqlite3 .dump` [5], which converts the whole
database to one UTF-8 text file, optionally wired in as a `textconv` diff driver [7]. **Inference:**
this gives readable diffs of a dump but still one big file, no per-note history views, no merge, and
no use from other editors. It is a diagnostic, not a portability feature, so I do not pursue it.

## What does not round-trip through `.md` + frontmatter

| Data | Why it is lost or ambiguous | What would carry it |
|---|---|---|
| Note id (integer, `AUTOINCREMENT`) | Not in the file. Also not unique across two machines (**Inference**: each DB hands out 1, 2, 3...). | Filename suffix, or an `id:` key, or a new unique id (see [Identity](#identity-and-multi-device)) |
| Group membership | "Database-only and never round-trips through the YAML block" (`docs/architecture/groups.md`) | Folder path, or a frontmatter key |
| The group tree, empty groups, group ids and timestamps | Folders exist only where a note lives; git does not record empty directories (the index has no directory entries [13]; the old Git FAQ says to add a placeholder file [14]) | Manifest, or a marker file per group |
| Duplicate sibling names | Neither groups nor notes have uniqueness constraints | Id in the name |
| Manual order (`position`) | `placeNote` rewrites `position` for every sibling (`notesRepo.ts:124-139`); stored per row | One manifest or per-folder order file; not per-note frontmatter (see [Ordering](#ordering)) |
| Trash (`trashed_notes`, `trashed_groups`, `deleted_at`) | Separate tables; trashing does not even copy `position` (`trashRepo.ts:19-30`) | A `.trash/` folder, or accept that deleted files vanish and git history is the trash |
| Attachments | Rows linking `note_id` to a stored file and the original name; deliberately not in frontmatter, and the frontmatter writer drops unknown keys (`attachments.md`, `frontmatter.ts`) | Sidecar manifest, or a typed `attachments:` key (requires extending `Frontmatter`) |
| Favorites, theme, layout, location | In per-app settings JSON, not the DB | Out of scope; stays local |
| Unknown frontmatter keys, YAML comments, key order | Dropped or normalized on save (see above) | Extend `Frontmatter` with a pass-through map; real work |
| `created_at` column vs `createdAt` in the text | Can already diverge (see above) | Define the file as winning on import |
| Image links | Notes say `app_data/<name>`, relative to the data dir, not to the note's folder | Copy `app_data/` into the notes folder and rewrite the prefix at the boundary (see [Images](#images-and-attachments)) |

## Prior art

| Project | Source of truth | What it shows | Source |
|---|---|---|---|
| Obsidian | A folder of Markdown files (the vault); a metadata cache that "can be rebuilt"; app config in a hidden `.obsidian` folder, some of it (`workspace.json`) churning on every note open, so "Git users may want to exclude" it; auto-refreshes on external changes | Option B in the wild. The cache/files split is the model; the config-folder note is a `.gitignore` lesson | [24], [25] |
| Logseq | Formerly Markdown/Org files; the DB version stores SQLite. Its forum says Markdown as the source of truth made sync, renames and collaboration hard; Git users are told to stay on the file modes; it now ships a **read-only Markdown mirror** and a two-way version is "in active development" with an ADR | The closest analogue to this repo's question, and it took the A-then-C order I recommend. Also a warning: DB mode is in beta with a data-loss caveat | [30], [31], [32], [33] |
| Joplin | Local database plus a sync target of files named by 32-hex ids; its FAQ says the format "is designed to be performant and reliable, not user friendly" and does not support real file names | A counterexample on filenames: id-only names are robust and unreadable. Not a git-friendly layout | [26], [27] |
| Dendron | Markdown vaults described as "a git backed folder for your notes", with an `id` in each note's frontmatter; the README says it is in maintenance only | Confirms `id:` in frontmatter as a convention for stable identity (and shows the project did not last) | [28], [29] |
| Zettlr | I could not retrieve a primary statement about its storage model | Not used | |

## Design options

Common facts first, then each option against the concerns in the brief.

### Identity and multi-device

Integer ids appear in 237 type annotations across `apps/*/src`, in the IPC validators
(`Number.isSafeInteger`, `apps/desktop/src/main/validate.ts:21-22`), in favorites, in the Meilisearch
primary key, and in attachment rows. Changing their type is a wide change. **Inference:** if
multi-device is ever wanted, the lowest-impact route is an additive column `uid TEXT` (the repo already
adds columns this way, `db.ts:68-96`), written to the file, with the integer `id` staying a local
row key so the API does not change. Until that exists, git can be one machine's history but not a
rendezvous between two machines' databases: both would write `something--5.md` for different notes.

### Filename scheme

Constraints from the platforms: Windows rejects `< > : " / \ | ? *`, control characters, the device
names `CON PRN AUX NUL COM1-9 LPT1-9` (also with an extension), and names ending in a space or period;
paths were limited to 260 characters before Windows 10 1607 unless opted in [20]. macOS APFS is
case-insensitive by default and normalization-insensitive while preserving what was written [19].
Git stores bytes and does no case folding, so two files differing only in case become one file on
disk and the other "looks modified" [11]; macOS git has `core.precomposeUnicode` to undo
decomposition [9]. Git does not track renames; it infers them after the fact [12].

| Scheme | Pros | Cons |
|---|---|---|
| `<id>.md` | Stable, no collisions, no illegal characters, no renames ever | Unreadable in a file manager, `git log` and diffs; the worst for "portability" |
| `<title-slug>.md` | Readable | Collisions (titles are not unique); renames on every title edit; case collisions on macOS/Windows; non-Latin titles slug to nothing |
| `<title-slug>--<id>.md` (recommended) | Readable; unique; case-insensitive-safe because of the id; id survives a rename so an importer can match a moved file; Windows device names are not an issue because of the suffix | Renames when the title changes; opaque slug for non-Latin titles; long |
| Keep Unicode titles, NFC-normalized | Readable in any script | Needs the full reserved-character logic above, plus case-insensitive collision detection and length caps; more ways to be wrong |

**Inference / recommendation:** reuse the existing `slug()` approach from `images.ts:36-46` (NFKD, strip
accents, lower-case, `[a-z0-9-]`, capped at 40 characters, falling back to `note` when empty). It is
already tested for this exact problem and stays inside every filesystem's rules. Always append `--<id>`.
Group folders need the same care but are user-visible navigation; a sanitized Unicode name with a
case-insensitive collision check, or the same slug, are both defensible. **Open question**.

Renames: git will show `slug-old--5.md -> slug-new--5.md` as a rename when content is similar [12].
Renaming on every autosave while the user types the title in the frontmatter would be noisy for
anything watching the folder; **Inference:** delay renames until the note has been idle, or do them
on pane close.

### Layout: folders or flat

- **Folders = groups.** Matches the UI tree and is what other tools expect. A group move or rename
  becomes a directory rename and N path changes in git (rename detection copes [12]). Empty groups
  need a placeholder or a manifest entry.
- **Flat with group path in frontmatter.** No file moves when groups change, but it adds a
  `group:` key the format does not have today and fights the documented decision that groups are
  not in frontmatter.

**Recommendation:** folders, with the group ids and order in a manifest (below). The mirror is
regenerated from the DB, so moving files is cheap for the app.

### Ordering

`placeNote`/`placeGroup` rewrite `position` for every sibling (`notesRepo.ts:124-139`,
`groupsRepo.ts:103-121`). If order lived in each note's frontmatter, dragging one note in a group of
50 would modify up to 50 files and conflict with any parallel edit. **Inference:** keep order in one
small manifest per mirror (or per folder): sorted keys, one entry per line, so line-based merges stay
local. Notes whose `position` is `NULL` need no entry; their order is derived from `updatedAt`.

### Images and attachments

- **Images** are content-hash named, so copying them is idempotent and they never change; git
  stores each once. They are never deleted by the app, so a mirror grows monotonically. Notes
  refer to `app_data/<name>` relative to the data dir. In the mirror, a file in `Work/Plans/x--7.md`
  needs `../../app_data/<name>` to render on GitHub or in another editor. **Inference:** rewrite the
  prefix at the mirror boundary and reverse it on import, as a pure function of folder depth, rather
  than changing the stored text.
- Copy rather than link: symlinks are not portable to Windows checkouts (**Inference**, not
  researched). APFS clones could avoid the disk cost (**Inference**; not researched).
- **Attachments** can be 1 GB and are binary. **Recommendation:** exclude from the git-tracked
  tree by default, optionally Git LFS [15], and record only names and sizes in the manifest. Git LFS
  needs an LFS-capable remote [15].

### Option A: one-way export/mirror (DB is truth, files are a projection)

- **Ids, groups, tags, ordering, trash:** ids in filenames; groups as folders; tags are in the file;
  order and group metadata in a manifest; trash is simply "file deleted", with git history as the
  long-term undo. (A `.trash/` folder is optional.)
- **Timestamps:** verbatim from `content`.
- **Search reindex:** unaffected. The mirror reads the DB; nothing flows back.
- **Concurrency:** each app process writes its own changes through the same hook, with temp-file +
  rename (the repo already does this for settings, `webSettings.ts:95-102`; POSIX `rename` replaces the
  target atomically so a reader sees the old or new file [35]). Two processes writing different
  notes do not interfere. Both writing the same note is already last-writer-wins in SQLite.
  Run a full reconcile at startup so that edits made while the mirror was off (and the seed tool)
  are caught.
- **External edits:** *not read*. This is the main hazard. A user who edits a mirrored file, or runs
  `git checkout`/`git pull`, will see it **silently overwritten** by the next sync, unless the
  mirror remembers the hash it last wrote and refuses to overwrite a file that no longer matches.
  Build that guard in step 1 and surface "N files changed outside the app".
- **Conflicts:** none inside the app. Git conflicts can only arise from the user's own merges, and
  nothing reads them back.
- **Merge/diff quality:** diffs are good for body edits (line-based text). Every edit also changes the
  `updatedAt` line [`service.ts:175`], so every diff has a noise line, and two machines editing one
  note would always conflict on that line (**Inference**: both sides changed the same line;
  git's three-way text merge cannot auto-resolve that, a custom merge driver or union is the usual
  workaround [7]).
- **What it gives:** history, diffs, blame, off-machine backup, and data readable by any editor.
- **Cost (Inference):** small to medium. New `mirror.ts`, ~15 hook calls in `service.ts`, settings, tests.

### Option B: Markdown files are the truth, SQLite a rebuildable index

- **Ids:** must live in the files (filename or `id:`); today they are `AUTOINCREMENT` row ids.
  Deleting the cache must not renumber notes or favorites would break (`saveFavorites`,
  `service.ts:547`).
- **Groups, order, trash, attachments:** all re-derived from folders and manifests on rebuild. Every
  table in `db.ts` becomes a cache with a rebuild path and a file-format spec.
- **Atomicity:** `trashNote` and `placeNote` are single SQL transactions touching several rows
  (`trashRepo.ts:19-30`, `notesRepo.ts:124-139`). As file operations they are many writes with no
  transaction; a crash mid-way leaves a half-applied state that startup must detect and repair
  (**Inference**).
- **Search:** `searchIndex.reindexAll` already rebuilds from `listNotes()`; fine.
- **Concurrency:** every process must notice file changes (watchers) or re-scan; the single-writer
  story of one SQLite file is replaced by "whoever writes the file".
- **External edits, git checkouts:** first class, which is the point. Needs watchers and a push
  channel (see option C).
- **Backup:** the backup format (`backup.ts`, `BACKUP_FORMAT_VERSION = 1`) assumes a DB snapshot; it
  would change, or become "tar the folder".
- **Precedent:** Obsidian [24]. **Cost (Inference):** large, and it reverses documented decisions in
  `data-model.md`, `search.md` and `backup-restore.md`.

### Option C: two-way sync (DB stays truth for the app; files are editable)

This is option A plus an importer.

- **State needed:** per note, the last-synced content hash and path (new table via the existing
  `CREATE TABLE IF NOT EXISTS` pattern in `db.ts`). With it, a three-way comparison classifies each
  note: DB changed only (write file), file changed only (ingest), both (conflict), neither (skip).
  Do not depend on git for the base; the user may never have initialised it.
- **Ingest path:** a new service function, not `saveNoteContent`. `saveNoteContent` sets
  `updatedAt = now`, re-renders the frontmatter, and drops unknown keys (`service.ts:161-189`).
  Ingesting through it would rewrite the file the user just got from `git pull`, dirtying their
  tree and starting a write/read loop (**Inference**). The importer must accept the file's own
  timestamps and not write the file back unless the DB side changes. It also needs
  `notesRepo` variants that set `created_at` and `updated_at` explicitly.
- **New file, no id:** create a note, then rename the file to include the id.
- **Deleted file:** move the note to the Trash Can, not a hard delete, so a mistaken
  `git rm`/checkout is recoverable (**Inference**).
- **Moved file / renamed folder:** detectable because of the id in the name; becomes
  `moveNoteToGroup` / `renameGroup`.
- **Reindex:** call `indexNote` per changed note, or `reindexAll` after a large pull.
- **Line endings:** with `core.autocrlf` on Windows, a checkout converts LF to CRLF [7], [11], so
  bytes differ from the DB while the text does not. Ship a `.gitattributes` with `* text eol=lf` [7]
  and normalize line endings before hashing, or the importer sees every file as changed.
- **BOM and editors:** strip a BOM before parsing (or the frontmatter is ignored, see above).
- **Merge-in-progress:** a file can hold `<<<<<<<` markers inside the frontmatter, making YAML
  invalid. `parse` already degrades to "raw content, columns untouched" (`frontmatter.ts:40-64`), which
  is a safe outcome. **Inference:** pause mirror writes while a merge or rebase is in progress so
  the app does not write over files git is resolving.
- **Merge/diff quality:** as A, plus real conflicts when the same note is edited in two places.
- **Cost (Inference):** medium for a manual import; large for live sync (below).

### What live sync adds (the large part of C)

1. **Watching.** Node's `fs.watch` is "not 100% consistent across platforms"; on macOS it uses
   kqueue for files and FSEvents for directories, is unreliable or impossible on network filesystems,
   and `filename` may be absent [16]. FSEvents may coalesce events and flag that a directory must be
   rescanned, and the event list is "advisory" [18]. Chokidar wraps `fs.watch`, merges the
   unlink-then-add pattern of editors that save via a temp file, and can wait for writes to finish
   [17]; v5 is ESM-only and needs Node 20+ [17]. Whatever is used, also do a content-hash scan at
   startup: it catches changes made while the app was closed (`git pull`) and is robust to dropped
   events (**Inference**). Ignore `.git/` entirely.
2. **A change channel to the UIs.** None exists (see above). Desktop needs a main-to-renderer event
   in `channels.ts`/`preload/index.ts`; the web app needs polling or SSE; the CLI needs a timer.
   Cheap fallback: re-run `loadWorkspace` on window focus.
3. **Editor conflicts.** `saveNoteContent(noteId, content)` carries no base version
   (`api.ts:94`), so an autosave from an open pane silently overwrites an external change made a
   moment earlier. Fixing it means a `baseUpdatedAt` argument through `api.ts`, `actions.ts`,
   `validate.ts`, the IPC channels and the CLI, plus UI for "this note changed on disk".
4. **Several processes.** Three apps may each run a watcher on the same folder. Imports are
   idempotent if driven by the hash comparison, but who writes first, and where to keep the
   sync-state table, are design questions (**open**).

### Comparison

| Concern | A: write-only mirror | B: files are truth | C: two-way |
|---|---|---|---|
| Single source of truth | DB | Files | DB, with files reconciled |
| Ids | Filename suffix | Must be in files | Filename suffix (+ uid for multi-device) |
| Groups / order / trash / attachments | Folders + manifest; trash = deleted file | All re-derived from files | Folders + manifest + sync state |
| External edit or `git checkout` | Ignored; must not be clobbered | Supported | Supported (import) |
| Conflicts | None in-app | In-app and via git | In-app and via git |
| Needs file watching and UI push | No | Yes | Manual: no. Live: yes |
| API change | No | Likely (ids) | Live: yes (`baseUpdatedAt`) |
| Multi-device via git | No | Needs unique ids | Needs unique ids |
| Reverses documented decisions | No | Yes | Partly (groups/attachments metadata) |
| Cost (Inference) | S-M | L | M (manual), L (live) |

## What git would and would not give users

**Would give** (with option A or C, folder as the repo root):

- Full history of every note, readable diffs (body plus an `updatedAt` line), `git blame`, `git log
  -- <file>`; rename tracking by similarity [12].
- A remote backup (any git remote), on top of the existing tarball backup, which is unencrypted and
  unscheduled (`backup-restore.md`, "Gaps").
- Data readable by Obsidian, VS Code, GitHub's renderer and others, since the format is Markdown
  with YAML frontmatter, which Jekyll and Hugo define as a convention [21], [22] and Obsidian reads
  as properties [25] (the key names `createdAt`/`updatedAt` differ from Dendron's `created`/`updated`
  [29]; harmless).

**Would not give:**

- **Restore an old version into the app**, under A. A `git checkout` changes files the app does not
  read. Needs C's import (manual import is enough).
- **Conflict-free multi-device sync.** Two clones imply two databases and colliding ids (see
  [Identity](#identity-and-multi-device)); and the `updatedAt` line conflicts on every concurrent
  edit.
- **Efficient large-binary history.** Images accumulate forever; attachments need exclusion or LFS [15].
- **Privacy.** A pushed repo holds plaintext notes, and anything a user pasted into one. Nothing in
  the app encrypts notes today (`backup-restore.md`, "Gaps").
- **Empty groups** without a placeholder or manifest entry [13], [14].

### Suggested `.gitignore` and `.gitattributes`

If the repo root is a dedicated notes folder (recommended), seed these once and never overwrite them:

```gitignore
# Large or binary user files; opt in to LFS instead if wanted
attachments/
# Editor and OS noise, and the app's own temp files from atomic writes
.DS_Store
*.tmp
.*.tmp
# Local, per-machine sync state (if kept as a file rather than in SQLite)
.composition/local/
```

```gitattributes
# Keep LF in the repository and in the working tree, so Windows autocrlf cannot make every file look edited
*.md   text eol=lf
*.json text eol=lf
```

If a user instead runs `git init` in the existing data directory, the minimum ignore set is
`composition.db*` (`-wal`, `-shm`, `-journal`), `meili_data/`, `meili.log`, `meili_master_key`,
`dumps/`, `settings.yaml` and `attachments/`; those are the same names `dataLocation.ts:29-31` moves as a set. Ignoring does not untrack anything already
committed [10]. **Recommendation:** do not support this layout; put the mirror in its own folder.

Git's own docs advise a `.gitattributes` that marks files as text or binary explicitly [11] and
describe `text`/`eol` normalization [7].

## Recommended path

Each step is shippable on its own. File and function names are from the current tree.

### Step 0: decisions to make first

- Mirror location and default (`~/Composition Notes`? inside `~/.composition/notes`? a user-chosen
  folder). Backups already default to a visible folder (`backup.defaultBackupDir`).
- Filename scheme (`slug--id.md` recommended), group-folder naming rule, manifest format.
- Does the mirror include trash? (Recommended: no; git history is the trash.)

### Step 1: write-only mirror (option A) with a no-clobber guard

- **New** `apps/web/src/lib/composition/mirror.ts` (framework-free like the rest of the folder):
  - a pure `projectWorkspace(notes, groups, ...) -> Map<relativePath, string>`;
  - `syncMirror(dir)`, which writes changed files (temp file then rename, as in
    `webSettings.saveWebSettings`), deletes stale ones, prunes empty folders, and records the hash it
    wrote so it can refuse to overwrite a file that no longer matches;
  - a per-note fast path for the hot save.
- **Hook** `service.ts` the way `bestEffortIndex` (`service.ts:59-65`) is used, so mirror failures
  never fail a write: `createNote` (221), `saveNoteContent` (161), `deleteNote` (234), `restoreNote`
  (450), `moveNoteToGroup` (493), `placeNote` (503), `createGroup` (411), `renameGroup` (418),
  `deleteGroup` (430), `moveGroup` (476), `placeGroup` (516), `permanentlyDelete*` (462, 467),
  `purgeExpiredTrash` (254), and a full resync after `restoreBackup` (after line 405, next to
  `reindexAll`) and at startup (`loadWorkspace`, 67; desktop `index.ts`; CLI `runtime.ts:61`).
  Structural changes (group rename or move) use the full reconcile; text edits use the fast path.
- **Settings:** add `notesDir?` and an enabled flag to `WebSettings` (`webSettings.ts:27-37`,
  `parseWebSettings:69`), to `SettingsSnapshot`/`SaveSettingsInput` in `api.ts`, the Settings forms
  (`apps/web/src/app/settings/SettingsForm.tsx`, `apps/cli/src/components/SettingsScreen.tsx`) and the
  desktop `validate.ts`. Keep this folder out of `moveApplicationData` (`dataLocation.ts:29-31`)
  unless it sits inside the data directory, in which case add it to `OTHER_ENTRIES`.
- **Images:** copy referenced `app_data/` files into the mirror and rewrite the prefix at the
  boundary, as a pure function.
- **Seed `.gitignore`/`.gitattributes`** once, never overwrite.
- **Tests:** temp-dir tests in the style of `db.test.ts`/`service.test.ts`: round trip of a note,
  rename, group move, case-colliding titles, a Windows-reserved title, a CJK title, a deleted note,
  a hand-edited file that must not be clobbered.
- **Docs to change:** `data-model.md` ("Notes are **not** stored as individual files"), `search.md`
  (unchanged but cross-link), `backup-restore.md`, `feature-matrix.md`.
- **Delivers:** history, diffs and backup via git on one machine. **Does not deliver:** restoring from
  git into the app.

### Step 2: manual "Import changes from files"

- A service function `importFromMirror()` returning a preview (new, changed, deleted, conflicting),
  then applying on confirmation. No watcher, no UI push; a Settings button in each app.
- **New** sync-state table in `db.ts` (additive, `CREATE TABLE IF NOT EXISTS`).
- **New** repo variants in `notesRepo.ts` that set `created_at`/`updated_at` explicitly, and a
  frontmatter pass-through for unknown keys (extend `Frontmatter` in `frontmatter.ts`, which today
  drops them).
- Normalize line endings and BOM before hashing and parsing.
- Index changed notes with `searchIndex.indexNote`, or `reindexAll` for big imports.
- Conflict policy for the first version: **do not merge**; list the note as conflicting and let the
  user choose DB or file.
- **Delivers:** "restore from git" and edit-in-another-editor.

### Step 3: live two-way sync (only if step 2 is not enough)

- Watcher on the folder (chokidar [17] or `fs.watch` with the caveats [16]) plus startup hash scan.
- A change event to the UIs (desktop `channels.ts` + `preload/index.ts`; web poll or SSE; CLI timer).
- `baseUpdatedAt` on `saveNoteContent` through `api.ts`, `actions.ts`, `validate.ts`, `ipc.ts`,
  `apps/cli/src/api.ts`, and an "open note changed on disk" UI.
- Decide which process owns the watcher when several apps are open.

### Step 4 (separate decision): multi-device identity

- Add `uid TEXT` to `notes` and `groups` via `ensureColumn`, backfill, write into the file. Keep
  integer ids as local keys. Only then can two clones share a repo. Also needs a merge strategy for
  `updatedAt` (a custom merge driver, which lives in git config rather than `.gitattributes` [7], so
  the app would have to set it up in each clone).

## Risks and open questions

- **Silent clobbering** of user edits by a write-only mirror. Mitigated by the hash guard; must be
  built and tested in step 1, not later.
- **Write/read loops** in two-way sync (normalizing frontmatter on import dirties the user's git
  tree). The importer must be idempotent and must not rewrite files it only read.
- **Frontmatter fidelity:** the writer drops unknown keys, so a user who adds `aliases:` in another
  editor loses it on the first in-app save. A pass-through map is needed before step 2 is honest.
- **`createdAt` source of truth** (file vs `created_at` column) and tags containing commas.
- **Filename churn:** renames on title edits; slug collisions across case; empty slugs for non-Latin
  titles. Whether group folders use slugs or sanitized Unicode.
- **Mirror location** relative to the data directory, backups and "move the data" (`dataLocation.ts`).
- **Per-note write cost:** I did not measure the mirror's cost at thousands of notes, the startup
  scan, or Meilisearch reindex time after a large pull. The local data set is tiny and tells us
  nothing.
- **Windows and Linux:** the desktop app is macOS-only for now (`docs/product-builds.md`), but the
  CLI and web run elsewhere; Windows rules [20] and `autocrlf` matter as soon as a repo is cloned there.
- **Atomic multi-file operations** (`trashNote`, `placeNote`) matter only for option B and live C.
- **Bundling git.** I did not research whether to shell out to `git` or embed a JavaScript
  implementation (Logseq's README credits isomorphic-git [33]). **Recommendation:** step 1 does no git
  at all; users run git themselves in the folder. An "auto-commit" feature is a later, optional
  add-on, and whether `git` is installed on a stock macOS is **not verified here**.
- **Privacy of a remote**, as above.
- **Zettlr** and other apps' behaviors that I could not verify from primary sources are left out.

## Sources

1. SQLite, [Write-Ahead Logging](https://www.sqlite.org/wal.html): the `-wal` and `-shm` files, "should be kept with the database if the database is copied or moved", checkpoint on last close, WAL not usable over a network filesystem, persistence of `journal_mode=WAL`.
2. SQLite, [How To Corrupt An SQLite Database File](https://www.sqlite.org/howtocorrupt.html): sections 1.2 (copying a live database; `VACUUM INTO`, backup API, `sqlite3_rsync`), 1.3-1.4 (hot journals, mispairing), 2.1 (network filesystem locking). The page does not mention Dropbox or other sync tools by name.
3. SQLite, [Temporary files used by SQLite](https://www.sqlite.org/tempfiles.html): `-journal`, `-wal` and `-shm` names and lifetimes.
4. SQLite, [Database file format](https://www.sqlite.org/fileformat2.html): the `SQLite format 3\0` header, fixed page size, change counter.
5. SQLite, [Command-line shell](https://www.sqlite.org/cli.html): `.dump` ("Converting An Entire Database To A Text File").
6. SQLite, [SQLite as an application file format](https://www.sqlite.org/appfileformat.html): atomic and incremental updates, a single portable file. It does not discuss version control. (Read for balance; not cited above.)
7. Git, [gitattributes](https://git-scm.com/docs/gitattributes): `diff`/`binary` and "Binary files differ", `textconv`, `merge=union` and custom merge drivers (defined in config), `text`/`eol`.
8. Pro Git, [Packfiles](https://git-scm.com/book/en/v2/Git-Internals-Packfiles): a one-line change stored as a new object; deltas appear after packing.
9. Git, [`core.*` configuration](https://raw.githubusercontent.com/git/git/master/Documentation/config/core.adoc): `core.ignoreCase`, `core.precomposeUnicode`, `core.protectNTFS`.
10. Git, [gitignore](https://git-scm.com/docs/gitignore): "Files already tracked by Git are not affected"; trailing-slash and anchoring rules.
11. Git, [gitfaq](https://git-scm.com/docs/gitfaq): case-differing files on Windows/macOS, line endings, recommended `.gitattributes`.
12. Pro Git, [Recording changes](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository): Git does not explicitly track renames.
13. Git, [index format](https://git-scm.com/docs/gitformat-index): the index records no entries for directories. This page does not itself mention empty directories; the inference that they are not tracked rests on this plus [14].
14. Git SCM Wiki (archived, marked obsolete), [Git FAQ](https://archive.kernel.org/oldwiki/git.wiki.kernel.org/index.php/Git_FAQ.html): add a placeholder file to keep an otherwise empty directory. Reported from a search result summary; not read in full.
15. [Git LFS](https://git-lfs.com/): replaces large files with text pointers; contents live on a remote server.
16. Node.js, [`fs.watch` caveats](https://nodejs.org/api/fs.html): availability per platform, network filesystems, inodes, optional `filename`.
17. [chokidar README](https://github.com/paulmillr/chokidar): native `fs.watch` default, `atomic`, `awaitWriteFinish`, v4/v5 requirements.
18. Apple, [File System Events Programming Guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html): coalescing and `MustScanSubDirs`, dropped events, persistent event IDs, "advisory". Archived documentation.
19. Apple, [APFS Guide FAQ](https://developer-mdn.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html) (retired document, mirror host): case-insensitive default on macOS; normalization-insensitive, preserving. The current Apple File System Reference PDF could not be read as text.
20. Microsoft, [Naming Files, Paths, and Namespaces](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file): reserved characters and device names, trailing space/period, case-insensitivity default, `MAX_PATH`.
21. Jekyll, [Front Matter](https://jekyllrb.com/docs/front-matter/): triple-dashed YAML, first thing in the file, no BOM.
22. Hugo, [Front matter](https://gohugo.io/content-management/front-matter/): YAML (`---`), TOML (`+++`), JSON; date formats.
23. YAML, [Timestamp type (YAML 1.1 type repository)](https://yaml.org/type/timestamp.html): working draft; unquoted ISO dates are timestamps.
24. Obsidian, [How Obsidian stores data](https://obsidian.md/help/data-storage): Markdown files in a vault; `.obsidian`; Git users may exclude `workspace.json`; automatic refresh on external changes; rebuildable metadata cache.
25. Obsidian, [Properties](https://obsidian.md/help/properties): YAML at the top of the file; lists; date formats. The page does not say whether key order or comments are preserved.
26. Joplin, [FAQ](https://joplinapp.org/help/faq): real file and folder names in the sync target are not supported.
27. Joplin, [REST API](https://joplinapp.org/help/api/references/rest_api/): 32-character hex ids, `parent_id`; and [Synchronisation spec](https://joplinapp.org/help/dev/spec/sync/): `sync_items`, conflicts. The spec page does not describe the file format.
28. Dendron, [README](https://github.com/dendronhq/dendron): "local-first, markdown-based", git-backed vaults, maintenance only.
29. Dendron, [Frontmatter](https://wiki.dendron.so/notes/ffec2853-c0e0-4165-a368-339db12c8e4b/): `id`, `title`, `desc`, `created`, `updated`. Reported from a search result summary; the page was not fetched directly.
30. Logseq forum, [Why the database version and how it's going?](https://discuss.logseq.com/t/why-the-database-version-and-how-its-going/26744): Markdown as source of truth made collaboration and renames hard; Markdown stays supported; two-way sync is a long-term goal.
31. Logseq forum, [Backwards compatibility between current Logseq version and next DB](https://discuss.logseq.com/t/backwards-compatibility-between-current-logseq-version-and-next-db/31306): a reply says Git users must use the plain-text modes because "Git can't do merge conflict handling of SQL files". The author's role as staff is not confirmed on the page.
32. Logseq forum, [What's New with Logseq DB - May 16th 2026](https://discuss.logseq.com/t/whats-new-with-logseq-db-may-16th-2026/35020): opt-in read-only Markdown mirror; two-way version in development; ADR 0017.
33. Logseq, [README](https://github.com/logseq/logseq): DB version in beta, data loss possible; credits isomorphic-git.
34. Meilisearch, [Updating](https://www.meilisearch.com/docs/learn/update_and_migration/updating): databases open only with the version that created them.
35. The Open Group, [`rename()`](https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html): replaces an existing target; the target stays visible as old or new. The page says "threads"; atomic semantics on Windows were not checked.

**Not retrievable or not verified:** Zettlr's documentation (404 / no storage statement); the Apple File
System Reference PDF (binary only); Git LFS hosting requirements beyond the home page; a first-party Git
page that states outright that empty directories are not tracked; whether macOS ships a usable `git`
without developer tools; behavior of `rename` on Windows; the size and speed of a mirror at thousands
of notes.
