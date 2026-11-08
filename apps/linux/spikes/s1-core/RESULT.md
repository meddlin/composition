# S1: the headless Rust core (schema, uuid pass, backup)

Run 2026-11-07. Code: `src/` (`schema.rs`, `pass.rs`, `backup.rs`, `timestamp.rs`), tests in `tests/`, the desktop-side verifier in
`tools/rust-fixtures.test.ts`, the whole flow in `run.sh`.

**Question.** Can a Rust crate with no GTK in it open the same `composition.db` as the desktop and the iPad, migrate it by the same
`ensureColumn` rule, carry the `uuid` pass, and round-trip the backup `.tar.gz`, so that a database either side has touched is a no-op
for the other? And does the SQLite it would ship have FTS5?

**Answer: yes on everything that was tried. Not tried: the change-capture triggers and outbox (not on `main`), the Trash Can and
store operation scripts, frontmatter, images, note links, settings.** See [What is not covered](#what-is-not-covered).

## What was checked, and against what

Every check below ran against files made by **the desktop's own TypeScript** (the real `db.ts`, repos and `createBackup`, from the iPad
branch's generator `apps/web/scripts/ios-conformance-fixtures.test.ts`), and, in the other direction, the desktop's own code ran on
files the Rust core wrote. No fixture was written for Rust.

| Check | Result |
|---|---|
| Schema made from nothing | `sqlite_master` (tables, indexes, triggers, with their SQL text) is **byte-identical** to the desktop's `desktop-empty.db`; `journal_mode = wal` |
| A desktop-populated database through the Rust pass | Every row and the schema unchanged; an observer connection's `data_version` did not move on the first open or the second: **the pass committed nothing** |
| A hand-made old database (no `uuid`, notebooks, positions or tags; 450 notes, so two full backfill batches and a part) | Every row of all six tables has a unique 32-character `uuid`; one default "Notebook" adopted every note and trashed note; the ticked to-do became `done`; a second pass writes nothing; a row inserted by an "old build" (no uuid, no notebook) gets its uuid from the trigger and its notebook on the next open |
| The desktop's real `db.ts` opening `rust-empty.db` and `rust-populated.db` | No DDL ran (`PRAGMA schema_version` unchanged) and every row equal before and after |
| Restore of the desktop's real backups (14 KB, and 20 MB with a large attachment) | Counts, every `uuid`, titles, the SHA-256 of every image and attachment, and `settings.json` all as the desktop wrote them |
| Backups Rust writes | Plain `tar tzf` lists them (manifest first); the desktop's real `stageBackup` and `applyStagedBackup` restore both sizes with the same counts, uuids and hashes |
| 13 hostile or broken archives | Refused, with nothing left in the data folder: not gzip, a duplicate entry, a symlink, an unknown name, `app_data/../../x.png`, a hidden file, no manifest, no database, a newer format version, a damaged database, a 2 MB manifest, a truncated archive, a bad header checksum |
| Memory | Restoring and re-creating the 20 MB backup peaked at **10.3 MB** resident (arm64 container): the archive streams |

## The SQLite that would ship

Asked of the library each build actually linked (`cargo run --bin probe`, and `the_linked_sqlite_has_fts5` in `tests/schema.rs`):

| Build | SQLite | FTS5 | `fts5vocab` | `trigram` | `unicode61 remove_diacritics 2` with `prefix` |
|---|---|:-:|:-:|:-:|:-:|
| `rusqlite` 0.41.1 with `bundled` (libsqlite3-sys 0.39.1) | 3.54.1 | yes | yes | yes | yes |
| `rusqlite` against Ubuntu 24.04's system `libsqlite3` | 3.45.1 | yes | yes | yes | yes |
| Fedora 45's `sqlite` (3.53.4) | not run | **unverified** | | | |

The desktop's `better-sqlite3` bundles 3.53.2. All three are far newer than WAL, `VACUUM INTO` (3.27) and the trigram tokenizer (3.34), so
none of the features the pass or the backup use is at risk. **Recommendation: `bundled`**, so the Rust app does not depend on what a
distribution built; the system build is kept compiling (`--no-default-features --features system-sqlite`) in case a Flatpak or distro
package wants it.

## Where it ran

| Platform | How | Result |
|---|---|---|
| macOS arm64 (the author's Mac) | native, Rust 1.97.1 | 12 of 12 tests |
| Ubuntu 24.04 arm64 | container, native speed | 12 of 12, bundled; 12 of 12, system SQLite |
| Ubuntu 24.04 x86-64 | the same container image's x86-64 variant, **emulated** on the Mac | 12 of 12, bundled |

Emulation proves the code and the C it compiles are correct on x86-64; it says nothing about speed there.

## Size

About **1,800 lines** of Rust in `src/` (schema text 210, schema and uuid pass 132, backup 484, search 849, timestamps 94), and about
790 more in tests and the TypeScript verifier. The iPad's Swift for `Schema`, `Backup/`, `Trash/` and `Search/` is about 2,050 lines, of
which the Trash Can (220) is not ported here yet. The Swift was the reference for the port; the desktop's TypeScript remains the
specification. Rust took roughly the same number of lines as Swift for the same work; this is a count, not a productivity claim.

## What is not covered

- **Change capture.** The `sync_outbox` triggers and `sync_*` tables are not on `main` (the sync design's P1), so there is nothing to
  reproduce yet. The pass is written so they are one more `CREATE ... IF NOT EXISTS` block.
- **The Trash Can** (`trash-script.json`, `trashNote` and friends, and the uuid carry-through) and **notes, groups, notebooks**
  (`store-script.json`): the corpus has scripts for both and the Rust core does not run them yet. They are build step 2.
- Frontmatter YAML (`js-yaml` rules), images, note links, favorites and settings: not started.
- The index is not kept in step with writes (no `fingerprint`, no hooks): only built and queried.

## Findings to act on

1. **The shared corpus is not on this branch's base.** `fixtures/conformance/` does not exist on `main`. The iPad's corpus is
   `apps/ios/conformance/` (about 1.1 MB, 13 files and a showcase folder) with its generator, on the iPad branch (PR #247). Later the same
   day the PDF-markup branch (PR #267, commit 5734532) created `fixtures/conformance/` with a README and `pdf/` fixtures only, saying the rest
   "is not here yet". The Rust harness reads the iPad's layout through one environment variable, `COMPOSITION_CONFORMANCE_DIR`, exactly as
   the Swift tests do. Nothing was copied into this branch. Choosing the one home is the user's call and gates the real harness.
2. **The Meilisearch lock has no Linux arm64 asset.** `apps/desktop/meilisearch.lock.json` pins `linux-x64` only. Upstream v1.53.1 has
   `meilisearch-linux-aarch64` (121 MB, community build), so the native app needs its own pin (not edited here).
3. A third copy of the schema text now exists (TypeScript, Swift, Rust). Each is kept identical on purpose and guarded by the corpus; there
   is no generator for the Rust file.
