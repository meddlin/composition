# S1: the .NET core library against the desktop's real data layer

**Result: 16 of 16 tests pass on macOS (arm64, .NET SDK 9.0.200); the whole suite, with S2's probe and S4's two sidecar tests, is 19 of 19.** Windows: run on 2026-11-12, see [below](#windows-run-2026-11-12).

## Windows run (2026-11-12)

The physical x64 PC (Windows 11 build 26300), .NET SDK 10.0.404, the spike unchanged (still `net9.0`, run on the .NET 10.0.15 runtime with
`DOTNET_ROLL_FORWARD=Major`), Microsoft.Data.Sqlite's win-x64 `e_sqlite3.dll` **executed** for the first time, against `main` at 79fe033.

- **15 of 17 .NET tests pass** (the two sidecar tests skip: no `meilisearch.exe` here). Passing on Windows includes **both backup round trips, the restore
  swap and the uuid and settings checks**, on NTFS with Windows file locks (R12's worry), and the no-op checks of the desktop's database.
- **The two failures and all three failures of the reverse phase are one cause, and it is not Windows:** `main` gained the PDF tables after this spike
  (`5734532 feat: shared schema and core for PDFs a note owns`: `documents`, `pdf_annotations`, `pdf_bookmarks`, their indexes and the `documents` uuid),
  and the C# port has not. The oracle noticed the drift as designed. Porting those statements is build step 1's job.
- S2's probe gives **the same numbers as on the Mac** (93 and 103 of 111 parse, 61 of 123 generate), now from `fixtures/conformance/` on `main`.

## What was built

`core/src/Composition.Core`: `Schema.cs` (a statement-for-statement port of `db.ts`'s `openConnection`, including `ensureColumn`,
`ensureUuids` with its `AFTER INSERT` trigger and unique index, the 200-row backfill and `adoptOrphans`), `TarGz.cs` + `Backup.cs` (a port
of `tarArchive.ts` and `backup.ts`, gzip from the framework), and `Search/MeiliSidecar.cs` (S4). Microsoft.Data.Sqlite 9.0.0, no other
runtime dependency. `core/tests` holds the tests. `oracle/*.oracle.ts` runs the **desktop's real TypeScript** (`db.ts`, `backup.ts`,
`frontmatter.ts`) from vitest, rooted at `apps/web`, and writes what it makes. `run-core-spike.sh` runs: TypeScript writes, .NET reads and
writes, TypeScript reads what .NET wrote.

## What it proves

| Claim | How it was checked |
|---|---|
| The SQLite that Microsoft.Data.Sqlite ships has **FTS5** | `PRAGMA compile_options` lists `ENABLE_FTS5` (SQLite 3.46.1, osx-arm64, executed). `unicode61 remove_diacritics 2`, prefix indexes, `bm25`, `fts5vocab`, `trigram` and `contentless_delete` all work |
| The **Windows binaries** have it too | **Inspected, not run:** `e_sqlite3.dll` for win-x64 and win-arm64 (SQLitePCLRaw 2.1.10) both contain `ENABLE_FTS5` in their compile-option tables and report 3.46.1 |
| A fresh .NET database has the **desktop's exact schema** | every row of `sqlite_master` (table, index and trigger SQL, byte for byte) and every `table_info` equal to what the real `db.ts` makes |
| The oldest database migrates the same way | the same comparison after both sides migrate the same pre-`tags` database; row data equal except the random uuids and the adopted notebook's timestamps |
| A database the desktop has touched is a **no-op** for .NET | `total_changes()` is 0, `schema_version` unchanged, schema and data equal before and after (the desktop's file is from `VACUUM INTO` under SQLite 3.53.2, read by 3.46.1) |
| A database .NET made is a no-op for the desktop | the real `db.ts` opens `net-fresh.db` and `net-old-migrated.db`: `sqlite_master`, `table_info`, `schema_version` and every row equal before and after |
| `uuid`: trigger, unique index, 200-row backfill | a 450-row old database gets 450 distinct 32-hex uuids; an insert without one gets one; a duplicate is refused |
| A **desktop backup restores in .NET** and the reverse | the real `createBackup` archive (settings, a GNU long-name entry, images, an attachment) restores through the .NET stage and apply; every column of the six uuid tables, uuids included, is equal. A .NET archive goes through the real `stageBackup`, `applyStagedBackup` and `db.ts`, with equal counts and rows |
| `settings.json` is carried as it came | bytes equal (the iPad plan's G5: a native app that rewrote it would reset the desktop's colour scheme on restore) |
| The system `tar` can list a .NET backup | `tar -tzf` (bsdtar here; Windows 10 1803+ ships one) |
| The checks can fail | two deliberate corruptions of the port (a dropped `NOT NULL`, a dropped unique index) each turned tests red, then were reverted |

## What it does not prove

- **Anything on Windows** (as of the Mac run; the backup and restore half has since passed on Windows, above). Known differences to test there: a pooled connection holds its file open after `Close()`, so `Pooling=False` is set
  and the restore swap is only exercised without a lock; `Utf8JsonWriter` defaults to `Environment.NewLine` (so `NewLine = "\n"` is set);
  NTFS mandatory locks and antivirus during `File.Move`.
- The Trash Can, notes, groups and notebooks **repositories** are not ported, so the operation scripts (the iPad's `trash-script.json`,
  `store-script.json`) are not run. See S2 for why they cannot be yet.
- `<net10.0>`: the spike targets `net9.0`, the only SDK here. .NET 9 (STS) ends support on **2026-11-10**; the design targets .NET 10 LTS
  (supported to 2028-11-14). Retargeting is one property but was not tried.
- The tests prove equality with the desktop's behaviour **as of this commit**. The DDL is copied, not shared; the oracle is what notices drift.
