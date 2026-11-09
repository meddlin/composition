mod common;

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use composition_core_spike::backup::{self, BackupCounts, BackupError, DataLocation};
use composition_core_spike::pass;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// What a data directory holds, in the shape the desktop's generator writes and reads as `*.expected.json`.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Expected {
    counts: BackupCounts,
    notes: Vec<Row>,
    #[serde(rename = "trashedNotes")]
    trashed_notes: Vec<Row>,
    files: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
struct Row {
    id: i64,
    uuid: String,
    title: String,
}

fn sha256_of(path: &Path) -> String {
    use std::io::Read;
    let mut hasher = Sha256::new();
    let mut file = File::open(path).unwrap();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).unwrap();
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// What the Rust core says is in `dir`, read through its own pass (so the schema pass runs on the restored file).
fn describe(dir: &Path, counts: BackupCounts) -> Expected {
    let conn = pass::open(&dir.join("composition.db")).unwrap();
    let rows = |table: &str| -> Vec<Row> {
        let mut stmt = conn.prepare(&format!("SELECT id, uuid, title FROM {table} ORDER BY id")).unwrap();
        stmt.query_map([], |r| Ok(Row { id: r.get(0)?, uuid: r.get(1)?, title: r.get(2)? })).unwrap().map(|r| r.unwrap()).collect()
    };
    let mut files = BTreeMap::new();
    for folder in ["app_data", "attachments", "documents"] {
        if let Ok(entries) = fs::read_dir(dir.join(folder)) {
            for e in entries {
                let e = e.unwrap();
                files.insert(format!("{folder}/{}", e.file_name().to_string_lossy()), sha256_of(&e.path()));
            }
        }
    }
    Expected { counts, notes: rows("notes"), trashed_notes: rows("trashed_notes"), files }
}

/// Restores `archive` into a new data directory the way the app does (stage, then apply), and reports what is there.
fn restore(archive: &Path, dir: &Path) -> (Expected, backup::StagedBackup) {
    let location = DataLocation::new(dir);
    let staged = backup::stage(archive, &location).unwrap();
    let counts = staged.counts.clone();
    let summary = backup::StagedBackup {
        directory: staged.directory.clone(),
        created_at: staged.created_at.clone(),
        counts: staged.counts.clone(),
        settings: staged.settings.clone(),
        has_images: staged.has_images,
        has_attachments: staged.has_attachments,
        has_documents: staged.has_documents,
    };
    backup::apply(&staged, &location, Some(&dir.join("settings.json"))).unwrap();
    (describe(dir, counts), summary)
}

fn desktop_expected(corpus: &Path, name: &str) -> Expected {
    serde_json::from_slice(&fs::read(corpus.join(format!("{name}.expected.json"))).unwrap()).unwrap()
}

#[test]
fn restores_a_backup_the_desktop_made_and_loses_nothing() {
    let corpus = need_corpus!();
    let dir = tempfile::tempdir().unwrap();
    let (restored, staged) = restore(&corpus.join("desktop-backup.tar.gz"), dir.path());
    assert_eq!(restored, desktop_expected(&corpus, "desktop-backup"), "counts, uuids, titles and file hashes");
    assert!(staged.settings.is_some(), "the backup's settings.json comes through");
    assert_eq!(Some(fs::read(dir.path().join("settings.json")).unwrap()), staged.settings, "settings.json is carried as it was");
    // The staging folder is gone.
    assert!(fs::read_dir(dir.path()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with(".restore-")));
}

/// Writes `rust-backup.tar.gz` (and its `.expected.json`, in the same shape the desktop's generator reads) from what the
/// desktop's backup restored to, for `tools/rust-fixtures.test.ts` to restore with the desktop's own `stageBackup`.
fn write_backup_from(corpus: &Path, source_archive: &str, out_name: &str) -> (PathBuf, std::time::Duration) {
    write_backup_with(corpus, source_archive, out_name, false)
}

/// `with_pdf` adds what the corpus's backups do not have: a PDF a note owns, as a `documents` row and a file in `documents/`.
fn write_backup_with(corpus: &Path, source_archive: &str, out_name: &str, with_pdf: bool) -> (PathBuf, std::time::Duration) {
    let dir = tempfile::tempdir().unwrap();
    let (mut before, _) = restore(&corpus.join(source_archive), dir.path());
    let conn = pass::open(&dir.path().join("composition.db")).unwrap();
    if with_pdf {
        let bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";
        fs::create_dir_all(dir.path().join("documents")).unwrap();
        fs::write(dir.path().join("documents/3f9c2a71b0de-paper.pdf"), bytes).unwrap();
        conn.execute(
            "INSERT INTO documents (note_id, file_name, stored_name, sha256, size, page_count, created_at) VALUES (1, 'paper.pdf', '3f9c2a71b0de-paper.pdf', 'x', ?1, 1, '2026-11-09T00:00:00.000Z')",
            [bytes.len() as i64],
        )
        .unwrap();
        before.files.insert("documents/3f9c2a71b0de-paper.pdf".to_string(), sha256_of(&dir.path().join("documents/3f9c2a71b0de-paper.pdf")));
    }
    let location = DataLocation::new(dir.path());
    let settings = fs::read(dir.path().join("settings.json")).ok();
    let out = corpus.join(format!("{out_name}.tar.gz"));
    let started = Instant::now();
    let summary = backup::create(&conn, &location, &out, settings.as_deref()).unwrap();
    let elapsed = started.elapsed();
    let mut expected = before;
    expected.counts = summary.counts.clone();
    if with_pdf {
        assert_eq!(summary.counts.documents, 1, "the PDF is counted");
    }
    fs::write(corpus.join(format!("{out_name}.expected.json")), serde_json::to_vec_pretty(&expected).unwrap()).unwrap();
    if let Some(s) = settings {
        fs::write(corpus.join(format!("{out_name}.settings.json")), s).unwrap();
    }
    eprintln!("{out_name}: {} bytes in {:.2} s, counts {:?}", summary.bytes, elapsed.as_secs_f64(), summary.counts);
    (out, elapsed)
}

#[test]
fn writes_a_backup_that_plain_tar_lists_and_the_core_restores() {
    let corpus = need_corpus!();
    let (out, _) = write_backup_from(&corpus, "desktop-backup.tar.gz", "rust-backup");
    let listing = std::process::Command::new("tar").arg("tzf").arg(&out).output().unwrap();
    assert!(listing.status.success(), "plain tar can read it: {}", String::from_utf8_lossy(&listing.stderr));
    let names: Vec<String> = String::from_utf8_lossy(&listing.stdout).lines().map(String::from).collect();
    assert_eq!(names[0], "composition-backup.json");
    assert!(names.contains(&"composition.db".to_string()) && names.iter().any(|n| n.starts_with("app_data/")), "{names:?}");
    // The core restores its own archive to the same thing.
    let dir = tempfile::tempdir().unwrap();
    let (restored, _) = restore(&out, dir.path());
    let mut expected = desktop_expected(&corpus, "desktop-backup");
    expected.counts = restored.counts.clone();
    assert_eq!(restored, expected);
}

#[test]
fn a_backup_with_a_pdf_round_trips_and_plain_tar_lists_it() {
    // The corpus's backups hold no PDF (a gap, reported in the design), so this one is built here, from the corpus's desktop backup.
    let corpus = need_corpus!();
    let (out, _) = write_backup_with(&corpus, "desktop-backup.tar.gz", "rust-backup-pdf", true);
    let listing = std::process::Command::new("tar").arg("tzf").arg(&out).output().unwrap();
    let names = String::from_utf8_lossy(&listing.stdout).to_string();
    assert!(names.lines().any(|n| n == "documents/3f9c2a71b0de-paper.pdf"), "{names}");
    let dir = tempfile::tempdir().unwrap();
    let (restored, staged) = restore(&out, dir.path());
    assert!(staged.has_documents);
    assert_eq!(restored.counts.documents, 1);
    assert!(restored.files.contains_key("documents/3f9c2a71b0de-paper.pdf"), "the PDF came back");
}

#[test]
fn the_large_backup_round_trips_and_streams() {
    let corpus = need_corpus!();
    if !corpus.join("desktop-backup-large.tar.gz").exists() {
        eprintln!("no large backup in the corpus dir: skipped");
        return;
    }
    let started = Instant::now();
    let dir = tempfile::tempdir().unwrap();
    let (restored, _) = restore(&corpus.join("desktop-backup-large.tar.gz"), dir.path());
    eprintln!("restored the large desktop backup in {:.2} s", started.elapsed().as_secs_f64());
    assert_eq!(restored, desktop_expected(&corpus, "desktop-backup-large"));
    write_backup_from(&corpus, "desktop-backup-large.tar.gz", "rust-backup-large");
}

// --- Hostile and broken archives: refused with nothing changed ------------------------------------------------------------

fn raw_header(name: &str, size: u64, kind: u8) -> [u8; 512] {
    let mut h = [0u8; 512];
    h[..name.len()].copy_from_slice(name.as_bytes());
    h[100..107].copy_from_slice(b"0000644");
    h[108..115].copy_from_slice(b"0000000");
    h[116..123].copy_from_slice(b"0000000");
    h[124..135].copy_from_slice(format!("{size:011o}").as_bytes());
    h[136..147].copy_from_slice(b"00000000000");
    h[148..156].copy_from_slice(b"        ");
    h[156] = kind;
    h[257..263].copy_from_slice(b"ustar\0");
    h[263..265].copy_from_slice(b"00");
    let sum: u32 = h.iter().map(|&b| b as u32).sum();
    h[148..155].copy_from_slice(format!("{sum:06o}\0").as_bytes());
    h
}

fn archive(entries: &[(&str, &[u8], u8)]) -> Vec<u8> {
    let mut gz = GzEncoder::new(vec![], Compression::default());
    for (name, data, kind) in entries {
        gz.write_all(&raw_header(name, data.len() as u64, *kind)).unwrap();
        gz.write_all(data).unwrap();
        gz.write_all(&vec![0u8; (512 - data.len() % 512) % 512]).unwrap();
    }
    gz.write_all(&[0u8; 1024]).unwrap();
    gz.finish().unwrap()
}

fn manifest(version: u64) -> Vec<u8> {
    format!("{{\"format\":\"composition-backup\",\"version\":{version},\"createdAt\":\"2026-01-01T00:00:00.000Z\",\"counts\":{{}}}}").into_bytes()
}

fn refused(bytes: Vec<u8>) -> BackupError {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("evil.tar.gz");
    fs::write(&file, bytes).unwrap();
    let location = DataLocation::new(dir.path().join("data"));
    let err = backup::stage(&file, &location).unwrap_err();
    let leftovers: Vec<_> = fs::read_dir(&location.directory).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert!(leftovers.is_empty(), "a refused restore leaves nothing behind: {leftovers:?}");
    err
}

#[test]
fn refuses_what_it_should_and_leaves_nothing_behind() {
    use BackupError::*;
    let good_db: &[u8] = b"not really a database";
    assert!(matches!(refused(b"this is not gzip at all".to_vec()), Damaged(_)));
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(1), b'0'), ("composition.db", good_db, b'0'), ("composition.db", good_db, b'0')])), DuplicateEntry(_)));
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(1), b'0'), ("app_data/x.png", b"x", b'2')])), ContainsNonFile(_)), "a symlink is an error, not a skip");
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(1), b'0'), ("evil.txt", b"x", b'0')])), UnknownFile(_)));
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(1), b'0'), ("app_data/../../x.png", b"x", b'0')])), UnknownFile(_)), "folder traversal");
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(1), b'0'), ("app_data/.hidden.png", b"x", b'0')])), UnknownFile(_)));
    assert!(matches!(refused(archive(&[("composition.db", good_db, b'0')])), NotABackup));
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(1), b'0')])), NoDatabase));
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(2), b'0')])), NewerFormat(2)));
    assert!(matches!(refused(archive(&[("composition-backup.json", &manifest(1), b'0'), ("composition.db", good_db, b'0')])), DatabaseDamaged));
    assert!(matches!(refused(archive(&[("composition-backup.json", &vec![b' '; 2 * 1024 * 1024], b'0')])), JsonTooLarge(_)));
    // Cut short: a valid archive with its tail removed.
    let whole = archive(&[("composition-backup.json", &manifest(1), b'0'), ("composition.db", &vec![7u8; 100_000], b'0')]);
    assert!(matches!(refused(whole[..whole.len() / 2].to_vec()), Damaged(_) | NoDatabase | NotABackup | DatabaseDamaged), "a truncated archive is refused");
    // A header that fails its checksum.
    let mut gz = GzEncoder::new(vec![], Compression::default());
    let mut header = raw_header("composition-backup.json", 5, b'0');
    header[0] = b'X';
    gz.write_all(&header).unwrap();
    gz.write_all(&[0u8; 1024]).unwrap();
    assert!(matches!(refused(gz.finish().unwrap()), Damaged(_)));
}
