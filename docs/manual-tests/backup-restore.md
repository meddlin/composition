# Manual test: backup and restore

A guided test, for one app at a time, driven from the command line. It builds a scratch home
full of known data, walks you through making a backup, **losing everything**, restoring, and then checks
from the command line that every note, image, attachment and setting came back. It never touches your
real notes or settings: everything is in a scratch folder (`/tmp/composition-manual-backup-<app>`).

How backup and restore work: [architecture/backup-restore.md](../architecture/backup-restore.md).

## Run it

From the repo root, on **Node 26.10 or newer** (the check tool is built with the terminal app's
toolchain; `nvm use 26`), with the dependencies installed for `apps/web`, `apps/cli`, and for the
app you test:

```bash
pnpm manual:backup cli
pnpm manual:backup web
pnpm manual:backup desktop
```

(Same as `scripts/manual-tests/backup-restore.sh <app>`.) It is a stage-by-stage wizard: it tells
you what to click, waits, and checks the result. It needs a **second terminal** for the app itself,
and says which command to run there.

## What each run does

| Stage | You | The wizard |
|---|---|---|
| 1 | | Builds the check tool and runs its headless self-test (backup → wipe → restore → verify, no app) |
| 2 | | Creates the test data: groups *Projects* ⊃ *Alpha*; notes *Welcome*, *Alpha plan*, *Picture note* (with an image), *Report note* (with an attached file), and *Deleted note* in the Trash Can; the Forest scheme, a city, column sizes and a pinned favorite |
| 3 | Start the app on that data (second terminal) and look around | Prints the command |
| 4 | **Create a backup** in Settings | Finds the file, lists what is in it and checks it against the test data |
| 5 | Quit the app | Wipes the database, images, attachments and settings, and shows `verify` failing (the loss is real) |
| 6 | Start the app again (it is empty), then **restore** the backup in Settings | |
| 7 | Look at the restored app | Runs `verify`: every note's text byte for byte, groups, Trash Can, image and attachment bytes, settings, no leftovers. Lists the "pre-restore" safety backup |
| 8 | Try to restore a file that is not a backup | Checks the data is unchanged |
| 9 | Quit the app | Reports, and offers to delete the scratch home |

Where to click, per app:

| | Backup | Restore |
|---|---|---|
| CLI | Settings row → `Tab` ×3 → `Enter` | Settings → `Tab` ×4 → paste the path → `Enter` → `y` |
| Web | `/settings` → Backup card → **Create backup** | Restore card → paste the path → **Restore…** → **Restore** |
| Desktop | Settings → **Create backup…** → type the path in the save dialog | **Restore from backup…** → **Restore** → `Cmd+Shift+G`, paste the path, Open |

Ask for the exact steps in the wizard; they are printed for the app you chose.

## The pieces, if you want to run them yourself

The wizard calls one tool, built from `apps/cli/src/tools/backupManual.ts`:

```bash
pnpm --dir apps/cli manual:backup <command> [--app cli|web|desktop] [--home DIR] [--file BACKUP]
```

| Command | What it does |
|---|---|
| `setup --app A --home DIR` | Creates the test data under `DIR`, with `A`'s settings layout |
| `launch --app A --home DIR` | Prints the command that starts app `A` on `DIR` |
| `verify --home DIR` | Compares `DIR` with what `setup` created; exits 1 on any difference |
| `wipe --home DIR [--force]` | Simulates losing everything (quit the app first) |
| `inspect --file F [--home DIR]` | Lists a backup and checks it against the test data |
| `backup --home DIR [--dir FOLDER]` | Makes a backup without the app |
| `restore --home DIR --file F` | Restores without the app |
| `selftest` | The whole loop for all three apps' layouts, headless |

Settings live in a different place for each app, which is what `--app` chooses:

| App | Settings file under the scratch home | Started with |
|---|---|---|
| CLI | `.composition-cli/settings.json` | `COMPOSITION_DEV_HOME=<home> pnpm --dir apps/cli dev` |
| Web | `.composition-web/settings.json` | `HOME=<home> ./node_modules/.bin/next dev` in `apps/web` |
| Desktop | `userData/settings.json` | `COMPOSITION_DEV_HOME=<home> pnpm --dir apps/desktop dev` |

## Things worth trying on top

- **Cross-app:** make a backup in one app and restore it in another (set up with `--app web`, restore
  in the CLI against its own scratch home). The format is the same everywhere.
- **Undo a restore:** after stage 7, restore the `composition-pre-restore-….tar.gz` from
  `<home>/Composition Backups`.
- **A backup from your real data:** back up your real notes in the app, then restore into a scratch
  home with `restore --home DIR --file F` (after a `setup`, which makes `DIR` a valid target).
- **Damage a backup:** `tar -xzf`, edit, re-create it with `COPYFILE_DISABLE=1 tar -czf`, and restore it.
  Or truncate it with `head -c 1000`. It must be refused with a message and change nothing.
- **Another app holding the database:** restoring while the CLI is open should be avoided; the
  Restore text says so.

## The automated checks behind this

| Where | What |
|---|---|
| `apps/web` `tarArchive.test.ts`, `backup.test.ts`, `BackupRestore.test.tsx` | The archive, the whole backup/restore round trip, refusals of hostile or damaged files, rollback, the Settings UI |
| `apps/desktop` `backup.test.ts`, `ipc.test.ts`, `validate.test.ts`; `pnpm smoke` | The dialog flow, that the renderer can't name a path, and the real app creating and restoring a backup |
| `apps/cli` `features.test.tsx`, `tools/backupFixture.test.ts` | The Settings screen's backup and restore, and the manual test's own fixture and verdict |
