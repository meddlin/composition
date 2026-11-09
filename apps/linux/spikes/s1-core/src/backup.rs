//! Backing up and restoring everything Composition keeps, in the format the desktop writes and reads
//! (docs/architecture/backup-restore.md, `backup.ts`, `tarArchive.ts`): one `.tar.gz` that plain `tar` can open.
//!
//! ```text
//! composition-backup.json   what this is, the format version, when, counts
//! settings.json             optional
//! composition.db            a consistent snapshot of the database (VACUUM INTO)
//! app_data/<image>          every pasted image
//! attachments/<file>        every attached file
//! documents/<file>          every PDF a note owns
//! ```
//!
//! Restoring is two steps so nothing is touched until the file is known to be good: `stage` unpacks and checks it in a
//! scratch folder, and `apply` swaps it in, with a rollback if anything fails halfway.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tar::{Builder, EntryType, Header};

use crate::timestamp::now_iso;

const FORMAT: &str = "composition-backup";
const FORMAT_VERSION: u64 = 1;
const MANIFEST: &str = "composition-backup.json";
const SETTINGS: &str = "settings.json";
const DATABASE: &str = "composition.db";
const IMAGE_DIR: &str = "app_data";
const ATTACHMENT_DIR: &str = "attachments";
const DOCUMENT_DIR: &str = "documents";
/// Manifest and settings are small; anything bigger is not one.
const MAX_JSON_BYTES: u64 = 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("cannot read {0}")]
    CannotRead(String),
    #[error("the file is not a gzip'd tar, or is cut short: {0}")]
    Damaged(String),
    #[error("the archive lists {0} twice")]
    DuplicateEntry(String),
    #[error("the archive holds something that is not a plain file: {0}")]
    ContainsNonFile(String),
    #[error("the archive holds a file the app does not make: {0}")]
    UnknownFile(String),
    #[error("not a Composition backup")]
    NotABackup,
    #[error("the backup has no database")]
    NoDatabase,
    #[error("the backup comes from a newer format (version {0}); update the app")]
    NewerFormat(u64),
    #[error("the {0} in the backup is too large")]
    JsonTooLarge(&'static str),
    #[error("the {0} in the backup is damaged")]
    JsonDamaged(&'static str),
    #[error("the database in the backup is damaged")]
    DatabaseDamaged,
    #[error("restore failed: {0}")]
    RestoreFailed(String),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

type Result<T> = std::result::Result<T, BackupError>;

/// Where the app keeps its data: the same layout as the desktop's data directory.
#[derive(Debug, Clone)]
pub struct DataLocation {
    pub directory: PathBuf,
}

impl DataLocation {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self { directory: directory.into() }
    }
    pub fn database(&self) -> PathBuf {
        self.directory.join(DATABASE)
    }
    pub fn images(&self) -> PathBuf {
        self.directory.join(IMAGE_DIR)
    }
    pub fn attachments(&self) -> PathBuf {
        self.directory.join(ATTACHMENT_DIR)
    }
    pub fn documents(&self) -> PathBuf {
        self.directory.join(DOCUMENT_DIR)
    }
}

/// How many of each thing a backup holds, under the names the desktop's manifest uses.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupCounts {
    pub notes: u64,
    pub groups: u64,
    pub trashed_notes: u64,
    pub trashed_groups: u64,
    pub attachments: u64,
    pub documents: u64,
    pub todos: u64,
    pub archived_todos: u64,
    pub contacts: u64,
    pub images: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest<'a> {
    format: &'a str,
    version: u64,
    created_at: &'a str,
    counts: &'a BackupCounts,
}

#[derive(Debug)]
pub struct BackupSummary {
    pub bytes: u64,
    pub created_at: String,
    pub counts: BackupCounts,
}

/// A backup unpacked and checked, waiting to be applied or discarded.
#[derive(Debug)]
pub struct StagedBackup {
    pub directory: PathBuf,
    pub created_at: String,
    pub counts: BackupCounts,
    /// The backup's `settings.json` as it was, or None when it had none.
    pub settings: Option<Vec<u8>>,
    pub has_images: bool,
    pub has_attachments: bool,
    pub has_documents: bool,
}

fn is_alnum(b: u8) -> bool {
    b.is_ascii_alphanumeric()
}

/// `^[A-Za-z0-9][A-Za-z0-9._-]*$`: one path segment, no leading dot.
pub fn is_stored_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty() && is_alnum(b[0]) && b.iter().all(|&c| is_alnum(c) || c == b'.' || c == b'_' || c == b'-')
}

/// `imageRefs.ts`: `^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$`, case-insensitive on the extension.
pub fn is_image_name(name: &str) -> bool {
    if !is_stored_name(name) {
        return false;
    }
    match name.rfind('.') {
        Some(dot) if dot > 0 => ["png", "jpg", "jpeg", "gif", "webp"].contains(&name[dot + 1..].to_ascii_lowercase().as_str()),
        _ => false,
    }
}

// --- Creating ------------------------------------------------------------------------------------------------------

/// Writes a backup of `conn` and the files in `location` to exactly `file`. The snapshot is taken with `VACUUM INTO`,
/// which is consistent while the app is writing. Written to a temporary name and renamed.
pub fn create(conn: &Connection, location: &DataLocation, file: &Path, settings: Option<&[u8]>) -> Result<BackupSummary> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let scratch = file.with_extension(format!("scratch-{}", std::process::id()));
    fs::create_dir_all(&scratch)?;
    let result = (|| -> Result<BackupSummary> {
        let snapshot = scratch.join(DATABASE);
        conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy().as_ref()])?;
        let mut counts = count_rows(&snapshot)?;
        let images: Vec<String> = stored_files(&location.images())?.into_iter().filter(|n| is_image_name(n)).collect();
        let attachments: Vec<String> = stored_files(&location.attachments())?.into_iter().filter(|n| is_stored_name(n)).collect();
        let documents: Vec<String> = stored_files(&location.documents())?.into_iter().filter(|n| is_stored_name(n)).collect();
        counts.images = images.len() as u64;
        let created_at = now_iso();
        let mut manifest = serde_json::to_vec_pretty(&Manifest { format: FORMAT, version: FORMAT_VERSION, created_at: &created_at, counts: &counts })
            .expect("manifest serialises");
        manifest.push(b'\n');

        let partial = PathBuf::from(format!("{}.partial", file.display()));
        let out = {
            let mut options = OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
            options.open(&partial)?
        };
        let written = (|| -> Result<()> {
            let mut tar = Builder::new(GzEncoder::new(out, Compression::default()));
            add_bytes(&mut tar, MANIFEST, &manifest)?;
            if let Some(settings) = settings.filter(|s| s.len() as u64 <= MAX_JSON_BYTES && is_json_object(s)) {
                add_bytes(&mut tar, SETTINGS, settings)?;
            }
            add_file(&mut tar, DATABASE, &snapshot)?;
            for name in &images {
                add_file(&mut tar, &format!("{IMAGE_DIR}/{name}"), &location.images().join(name))?;
            }
            for name in &attachments {
                add_file(&mut tar, &format!("{ATTACHMENT_DIR}/{name}"), &location.attachments().join(name))?;
            }
            for name in &documents {
                add_file(&mut tar, &format!("{DOCUMENT_DIR}/{name}"), &location.documents().join(name))?;
            }
            tar.into_inner()?.finish()?.sync_all()?;
            Ok(())
        })();
        match written {
            Ok(()) => fs::rename(&partial, file)?,
            Err(e) => {
                let _ = fs::remove_file(&partial);
                return Err(e);
            }
        }
        Ok(BackupSummary { bytes: fs::metadata(file)?.len(), created_at, counts })
    })();
    let _ = fs::remove_dir_all(&scratch);
    result
}

fn is_json_object(bytes: &[u8]) -> bool {
    matches!(serde_json::from_slice::<serde_json::Value>(bytes), Ok(serde_json::Value::Object(_)))
}

fn header(size: u64) -> Header {
    // GNU headers: `append_data` emits a GNU long-name entry when the path is over 100 bytes, as `tarArchive.ts` does.
    let mut h = Header::new_gnu();
    h.set_size(size);
    h.set_mode(0o644);
    h.set_uid(0);
    h.set_gid(0);
    h.set_mtime(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
    h.set_entry_type(EntryType::Regular);
    h
}

fn add_bytes<W: Write>(tar: &mut Builder<W>, name: &str, data: &[u8]) -> Result<()> {
    let mut h = header(data.len() as u64);
    tar.append_data(&mut h, name, data)?;
    Ok(())
}

/// A file streamed from disk. Its size is read from the open file, so the header and the bytes cannot disagree.
fn add_file<W: Write>(tar: &mut Builder<W>, name: &str, path: &Path) -> Result<()> {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()), // gone since the folder was listed
        Err(e) => return Err(e.into()),
    };
    let mut h = header(file.metadata()?.len());
    tar.append_data(&mut h, name, file)?;
    Ok(())
}

/// The regular, non-hidden files of a folder, by name; a missing folder has none.
fn stored_files(dir: &Path) -> Result<Vec<String>> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.into()),
    };
    let mut names = vec![];
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            if let Some(name) = entry.file_name().to_str() {
                if !name.starts_with('.') {
                    names.push(name.to_string());
                }
            }
        }
    }
    names.sort();
    Ok(names)
}

// --- Reading what is in a database ---------------------------------------------------------------------------------

/// Opens a database file that nothing else is using, for reading. `immutable=1` matters: a file whose header says WAL
/// mode cannot be opened by a plain read-only connection (it would need to create `-wal` and `-shm`), and the desktop
/// opens such a file, so an archive it restores must not be refused here.
fn read_only(path: &Path) -> rusqlite::Result<Connection> {
    let mut encoded = String::new();
    for b in path.to_string_lossy().bytes() {
        match b {
            b'%' | b'?' | b'#' | b' ' | b'"' => encoded.push_str(&format!("%{b:02X}")),
            _ => encoded.push(b as char),
        }
    }
    Connection::open_with_flags(format!("file:{encoded}?immutable=1"), OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI)
}

/// Row counts of a database file, opened read-only. A table or column an older version never created counts as 0.
fn count_rows(path: &Path) -> rusqlite::Result<BackupCounts> {
    let conn = read_only(path)?;
    let count = |table: &str, cond: &str| -> u64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE {cond}"), [], |r| r.get::<_, i64>(0)).map(|n| n as u64).unwrap_or(0)
    };
    let archived = count("todos", "archived_at IS NOT NULL");
    Ok(BackupCounts {
        notes: count("notes", "1"),
        groups: count("groups", "1"),
        trashed_notes: count("trashed_notes", "1"),
        trashed_groups: count("trashed_groups", "1"),
        attachments: count("attachments", "1"),
        documents: count("documents", "1"),
        archived_todos: archived,
        todos: count("todos", "1").saturating_sub(archived),
        contacts: count("contacts", "1"),
        images: 0,
    })
}

fn assert_usable_database(path: &Path) -> Result<()> {
    let conn = read_only(path).map_err(|_| BackupError::DatabaseDamaged)?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|_| BackupError::DatabaseDamaged)?;
    let has_notes: Option<i64> = conn
        .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes'", [], |r| r.get(0))
        .ok();
    if check == "ok" && has_notes.is_some() {
        Ok(())
    } else {
        Err(BackupError::DatabaseDamaged)
    }
}

// --- Restoring -----------------------------------------------------------------------------------------------------

fn read_limited(entry: &mut impl Read, size: u64, what: &'static str) -> Result<Vec<u8>> {
    if size > MAX_JSON_BYTES {
        return Err(BackupError::JsonTooLarge(what));
    }
    let mut data = Vec::with_capacity(size as usize);
    entry.read_to_end(&mut data)?;
    Ok(data)
}

/// Unpacks and validates the backup at `file` into a scratch folder inside `location`, the same disk the files will end
/// up on, so the swap is a rename. Every entry name is checked against the shapes the app itself generates, so a hostile
/// archive cannot write outside the folder or smuggle in a file the app would later serve or open.
pub fn stage(file: &Path, location: &DataLocation) -> Result<StagedBackup> {
    let input = File::open(file).map_err(|_| BackupError::CannotRead(file.display().to_string()))?;
    fs::create_dir_all(&location.directory)?;
    let directory = location.directory.join(format!(".restore-{}-{}", std::process::id(), now_iso().replace([':', '.'], "")));
    fs::create_dir(&directory)?;
    let result = stage_into(input, &directory);
    if result.is_err() {
        let _ = fs::remove_dir_all(&directory);
    }
    result
}

fn stage_into(input: File, directory: &Path) -> Result<StagedBackup> {
    let damaged = |e: io::Error| BackupError::Damaged(e.to_string());
    let mut archive = tar::Archive::new(GzDecoder::new(input));
    let mut seen = HashSet::new();
    let (mut manifest_created, mut settings, mut has_database) = (None::<String>, None::<Vec<u8>>, false);
    let (mut images, mut attachments, mut documents) = (0u64, 0u64, 0u64);

    for entry in archive.entries().map_err(damaged)? {
        let mut entry = entry.map_err(damaged)?;
        let kind = entry.header().entry_type();
        let name = entry.path().map_err(damaged)?.to_string_lossy().into_owned();
        match kind {
            EntryType::Directory | EntryType::XGlobalHeader => continue,
            EntryType::Regular | EntryType::Continuous => {}
            _ => return Err(BackupError::ContainsNonFile(name)),
        }
        if !seen.insert(name.clone()) {
            return Err(BackupError::DuplicateEntry(name));
        }
        let size = entry.size();
        if name == MANIFEST {
            let data = read_limited(&mut entry, size, "description").map_err(|e| match e {
                BackupError::Io(io) => BackupError::Damaged(io.to_string()),
                other => other,
            })?;
            let value: serde_json::Value = serde_json::from_slice(&data).map_err(|_| BackupError::JsonDamaged("description"))?;
            let object = value.as_object().ok_or(BackupError::NotABackup)?;
            if object.get("format").and_then(|v| v.as_str()) != Some(FORMAT) {
                return Err(BackupError::NotABackup);
            }
            let version = object.get("version").and_then(|v| v.as_u64()).ok_or(BackupError::NotABackup)?;
            if version > FORMAT_VERSION {
                return Err(BackupError::NewerFormat(version));
            }
            manifest_created = Some(object.get("createdAt").and_then(|v| v.as_str()).unwrap_or("").to_string());
            continue;
        }
        if name == SETTINGS {
            let data = read_limited(&mut entry, size, "settings").map_err(|e| match e {
                BackupError::Io(io) => BackupError::Damaged(io.to_string()),
                other => other,
            })?;
            serde_json::from_slice::<serde_json::Value>(&data).map_err(|_| BackupError::JsonDamaged("settings"))?;
            settings = Some(data);
            continue;
        }
        let target = if name == DATABASE {
            has_database = true;
            directory.join(DATABASE)
        } else {
            let parts: Vec<&str> = name.split('/').collect();
            let ok = parts.len() == 2
                && ((parts[0] == IMAGE_DIR && is_image_name(parts[1]))
                    || (parts[0] == ATTACHMENT_DIR && is_stored_name(parts[1]))
                    || (parts[0] == DOCUMENT_DIR && is_stored_name(parts[1])));
            if !ok {
                return Err(BackupError::UnknownFile(name));
            }
            if parts[0] == IMAGE_DIR {
                images += 1;
            } else if parts[0] == DOCUMENT_DIR {
                documents += 1;
            } else {
                attachments += 1;
            }
            let folder = directory.join(parts[0]);
            fs::create_dir_all(&folder)?;
            folder.join(parts[1])
        };
        // `create_new` is O_EXCL: an existing file there is an error, never overwritten.
        let mut out = OpenOptions::new().write(true).create_new(true).open(&target).map_err(|_| BackupError::DuplicateEntry(name.clone()))?;
        io::copy(&mut entry, &mut out).map_err(damaged)?;
    }

    let created_at = manifest_created.ok_or(BackupError::NotABackup)?;
    if !has_database {
        return Err(BackupError::NoDatabase);
    }
    let staged_db = directory.join(DATABASE);
    assert_usable_database(&staged_db)?;
    let mut counts = count_rows(&staged_db)?;
    counts.images = images;
    Ok(StagedBackup { directory: directory.to_path_buf(), created_at, counts, settings, has_images: images > 0, has_attachments: attachments > 0, has_documents: documents > 0 })
}

pub fn discard(staged: &StagedBackup) {
    let _ = fs::remove_dir_all(&staged.directory);
}

/// Replaces the current database, images and attachments with the staged ones, then removes the scratch folder. What was
/// there is set aside first and put back if anything fails, so the app is never left half restored. The caller must have
/// closed the database, and should have taken a backup of the current data first: a restore replaces, it never merges.
pub fn apply(staged: &StagedBackup, location: &DataLocation, settings_file: Option<&Path>) -> Result<()> {
    let aside = staged.directory.join("previous");
    fs::create_dir(&aside)?;

    let db = location.database();
    let mut swaps: Vec<(PathBuf, Option<PathBuf>)> = vec![];
    if let (Some(data), Some(target)) = (&staged.settings, settings_file) {
        let file = staged.directory.join(SETTINGS);
        fs::write(&file, data)?;
        swaps.push((target.to_path_buf(), Some(file)));
    }
    swaps.push((db.clone(), Some(staged.directory.join(DATABASE))));
    for suffix in ["-wal", "-shm", "-journal"] {
        swaps.push((PathBuf::from(format!("{}{suffix}", db.display())), None));
    }
    swaps.push((location.images(), staged.has_images.then(|| staged.directory.join(IMAGE_DIR))));
    swaps.push((location.attachments(), staged.has_attachments.then(|| staged.directory.join(ATTACHMENT_DIR))));
    swaps.push((location.documents(), staged.has_documents.then(|| staged.directory.join(DOCUMENT_DIR))));

    let mut set_aside: Vec<(PathBuf, PathBuf)> = vec![];
    let mut placed: Vec<PathBuf> = vec![];
    let attempt = (|| -> io::Result<()> {
        for (i, (current, _)) in swaps.iter().enumerate() {
            if fs::symlink_metadata(current).is_ok() {
                let parked = aside.join(i.to_string());
                fs::rename(current, &parked)?;
                set_aside.push((current.clone(), parked));
            }
        }
        for (current, replacement) in &swaps {
            if let Some(replacement) = replacement {
                fs::rename(replacement, current)?;
                placed.push(current.clone());
            }
        }
        Ok(())
    })();
    if let Err(e) = attempt {
        for p in placed.iter().rev() {
            let _ = fs::remove_dir_all(p).or_else(|_| fs::remove_file(p));
        }
        // If this fails nothing more can be done; the previous data stays in the scratch folder, kept for that reason.
        for (current, parked) in set_aside.iter().rev() {
            let _ = fs::rename(parked, current);
        }
        return Err(BackupError::RestoreFailed(e.to_string()));
    }
    let _ = fs::remove_dir_all(&staged.directory);
    Ok(())
}
