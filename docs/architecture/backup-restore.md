# Backup and restore

Source: [`backup.ts`](../../apps/web/src/lib/composition/backup.ts),
[`tarArchive.ts`](../../apps/web/src/lib/composition/tarArchive.ts),
[`backupApi.ts`](../../apps/web/src/lib/composition/backupApi.ts),
[`service.ts`](../../apps/web/src/lib/composition/service.ts) (`createBackup`, `restoreBackup`),
[`BackupRestore.tsx`](../../apps/web/src/app/settings/BackupRestore.tsx) (web and desktop),
[`SettingsScreen.tsx`](../../apps/cli/src/components/SettingsScreen.tsx) (CLI),
[`main/backup.ts`](../../apps/desktop/src/main/backup.ts)

**Settings → Backup** saves everything to one file. **Settings → Restore** replaces everything
with a backup. All three apps do both, through the same code. To test it by hand, see
[manual-tests/backup-restore.md](../manual-tests/backup-restore.md).

## What a backup holds

One `.tar.gz`, named `composition-backup-2026-10-02-153045.tar.gz` (local time), which plain `tar`
can list and unpack, so a backup never locks the user into this app:

```
composition-backup.json   what this is, the format version, when, how many of each thing
settings.json             color scheme, city, column sizes, favorites
composition.db            a consistent snapshot of the database
app_data/<image>          every pasted image
attachments/<file>        every attached file
```

The database holds the notes, groups, the Trash Can and the attachment records, so those come
back too. Two things are deliberately **not** in it:

- **The search index.** It is derived from the database ([search.md](search.md)); a restore
  rebuilds it.
- **The data location** (`appDataDir`, `dbPath`). Those say where *this machine* keeps its
  files. A backup made on another machine must not repoint the app, so a restore keeps the current
  location and puts the files there.

The snapshot is taken with SQLite's `VACUUM INTO`, which is consistent even while the app is
writing; copying a WAL-mode database file by hand is not.

## Restoring

Restoring is two steps, so nothing is touched until the file is known to be good.

1. **Stage** (`stageBackup`): unpack into a scratch folder inside the data directory (the same
   disk the files end up on, so the swap is a rename) and check it. A restore is refused, with
   nothing changed, when the file:
   - is not a gzip'd tar, or is cut short, or has a header that fails its checksum;
   - contains anything but plain files (a link, device or folder-traversal name is an error, not a
     skip), or any name other than the five above (`app_data/` entries must look like a stored image,
     `attachments/` entries like a stored file: one path segment, no leading dot);
   - lists a name twice, has no manifest or no database, or comes from a newer format version;
   - holds a database that is not intact SQLite with a `notes` table (`PRAGMA quick_check`).
2. **Save what is there**: the current data goes to a `composition-pre-restore-….tar.gz` in
   `~/Composition Backups`, so a restore can itself be undone by restoring that file. If that backup
   can't be made, nothing is restored.
3. **Apply** (`applyStagedBackup`): the database, `app_data/` and `attachments/` are set aside, the
   staged ones moved in, and the settings merged (the backup's choices, this machine's location). If any
   move fails everything is put back. Then the scratch folder is deleted and the search index rebuilt.

A restore **replaces**; it never merges. Files written after the backup are gone afterwards (and
in the pre-restore backup). Other Composition apps must be closed: they would be holding the old
database open.

Older backups restore into newer builds, because opening the database adds whatever columns and
tables it lacks (`db.ts`). Newer backups are refused with a message to update.

## Where the person picks the file

| App | Backup | Restore |
|---|---|---|
| Web | Types a folder (default `~/Composition Backups`); a new timestamped file goes in it | Types the path of a file |
| CLI | Same, in two text boxes at the bottom of Settings; `Enter` creates, `Enter` then `y` restores | Same |
| Desktop | A save dialog | An open dialog |

The web app is the person's own local server, so asking for a path is no different from its
"Application data directory" field. **The desktop app must not**: its renderer is untrusted, so the
renderer only asks to "back up" or "restore" and the main process opens the dialogs
([`DesktopBackupApi`](../../apps/web/src/lib/composition/backupApi.ts), the same rule as
[attachments](attachments.md)). The IPC validators for those two methods accept no arguments at all.

This is why backup is **not** in `CompositionApi`: that contract is exposed over IPC as well, and
would have given the renderer a path to write to. The web app has its own Server Actions
(`backupActions.ts`) and the desktop app its own bridge methods, and the Settings component picks
the right behaviour at build time (`backupClient.ts` / `backupClient.desktop.ts`; `BACKUP_NEEDS_PATH`).

After a restore the web and desktop pages reload (the color scheme, favorites and notes all came
from the data that was just replaced) and show what was restored. The CLI saves open notes first,
so a backup has the latest edits and a restore leaves no half-written autosave behind, then closes
its panes and reloads the tree, favorites and color scheme.

## The archive code

[`tarArchive.ts`](../../apps/web/src/lib/composition/tarArchive.ts) is a hundred-odd-line tar
writer and reader over Node's built-in gzip. It streams (a 100 MB attachment is never held in
memory), writes GNU long names for paths over 100 bytes, and understands the POSIX `path` extension
so an archive re-created with the system `tar` still restores. It is deliberately strict where a
general extractor is lenient; the tests include archives made by the system `tar` in both
directions and hostile ones (a symlink, `../` names, a truncated file, junk bytes).

One consequence: macOS `tar` adds `._name` files to an archive it creates unless
`COPYFILE_DISABLE=1` is set, and the reader refuses them. Backups the app makes are unaffected.

## Gaps

- Backups are not encrypted or compressed beyond gzip, and are not scheduled; the person makes them.
- There is no list of existing backups in the apps; the person points at the file.
- The Meilisearch index is rebuilt after a restore, not restored.
- Restoring while another Composition app has the database open is not detected.
