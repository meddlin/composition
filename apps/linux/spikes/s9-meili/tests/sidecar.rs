//! S9: the sidecar and the index, against a real Meilisearch. Needs `MEILISEARCH_BIN` (the pinned v1.53.1 build for the platform) and
//! `COMPOSITION_CONFORMANCE_DIR` (the corpus and the desktop-made files, see ../../s1-core/run.sh); skips with a message otherwise.

use std::collections::HashMap;
use std::fs;
#[cfg(target_os = "linux")]
use std::io::{BufRead, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "linux")]
use std::process::Stdio;
use std::time::Instant;
#[cfg(target_os = "linux")]
use std::time::Duration;

use composition_core_spike::pass;
use composition_meili_spike::index::{load_notes, NotesIndex};
use composition_meili_spike::supervisor::{is_alive, MeiliOptions, MeiliProcess};
use serde::Deserialize;

fn binary() -> Option<PathBuf> {
    std::env::var_os("MEILISEARCH_BIN").map(PathBuf::from).filter(|p| p.is_file())
}

fn corpus() -> Option<PathBuf> {
    std::env::var_os("COMPOSITION_CONFORMANCE_DIR").map(PathBuf::from).filter(|p| p.is_dir())
}

macro_rules! need {
    () => {
        match (binary(), corpus()) {
            (Some(b), Some(c)) => (b, c),
            _ => {
                eprintln!("MEILISEARCH_BIN or COMPOSITION_CONFORMANCE_DIR is not set: skipped");
                return;
            }
        }
    };
}

#[derive(Deserialize)]
struct Group {
    queries: Vec<String>,
}
#[derive(Deserialize)]
struct QueriesFile {
    groups: Vec<Group>,
}
#[derive(Deserialize)]
struct Answer {
    query: String,
    ids: Vec<i64>,
}
#[derive(Deserialize)]
struct Corpus {
    results: Vec<Answer>,
}
#[derive(Deserialize)]
struct Expected {
    meilisearch: String,
    corpora: HashMap<String, Corpus>,
}

fn memory_kb(pid: u32) -> (u64, u64) {
    // (resident now, resident high-water mark), from /proc on Linux, from `ps` elsewhere (no high-water mark there).
    if let Ok(status) = fs::read_to_string(format!("/proc/{pid}/status")) {
        let field = |name: &str| status.lines().find(|l| l.starts_with(name)).and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse().ok()).unwrap_or(0);
        return (field("VmRSS:"), field("VmHWM:"));
    }
    let out = Command::new("ps").args(["-o", "rss=", "-p", &pid.to_string()]).output().unwrap();
    let rss = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0);
    (rss, rss)
}

fn started(state: &Path) -> (MeiliProcess, composition_meili_spike::supervisor::Handle) {
    let (bin, _) = (binary().unwrap(), ());
    let mut meili = MeiliProcess::new(MeiliOptions::new(bin, state));
    let began = Instant::now();
    let handle = meili.start().expect("start");
    eprintln!("healthy in {:.0} ms", began.elapsed().as_secs_f64() * 1000.0);
    (meili, handle)
}

fn notes_of(corpus: &Path, size: &str, scratch: &Path) -> Vec<composition_core_spike::search::IndexedNote> {
    let db = scratch.join(format!("composition-{size}.db"));
    fs::copy(corpus.join(format!("search-corpus-{size}.db")), &db).unwrap();
    load_notes(&pass::open(&db).unwrap())
}

#[test]
fn starts_the_way_the_desktop_starts_it() {
    let (_, _corpus) = need!();
    let dir = tempfile::tempdir().unwrap();
    let (mut meili, handle) = started(dir.path());
    let o = meili.options().clone();

    assert_eq!(fs::metadata(&o.key_path).unwrap().permissions().mode() & 0o777, 0o600, "the master key file is the owner's alone");
    assert_eq!(fs::read_to_string(&o.pid_path).unwrap().trim(), handle.pid.to_string(), "the pid file names the child");
    assert!(handle.url.starts_with("http://127.0.0.1:"), "loopback only");
    assert!(!NotesIndex::answers_without_key(&handle.url), "production mode with a master key: no key, no answer");
    let index = NotesIndex::new(&handle.url, &handle.master_key);
    let version = index.version().unwrap();
    eprintln!("Meilisearch {version}");
    assert!(version.starts_with("1."));
    // The key is in the environment, not in argv, so `ps` does not show it.
    let cmdline = Command::new("ps").args(["-p", &handle.pid.to_string(), "-o", "command="]).output().unwrap();
    assert!(!String::from_utf8_lossy(&cmdline.stdout).contains(&handle.master_key), "the key is not on the command line");
    assert!(String::from_utf8_lossy(&cmdline.stdout).contains(&o.data_dir.to_string_lossy().into_owned()), "the data folder is: that is how an orphan is recognised");
    assert!(o.data_dir.parent().unwrap().join("dumps").parent().is_some());

    meili.stop();
    assert!(!is_alive(handle.pid as i32), "stop stopped it");
    assert!(!o.pid_path.exists(), "and removed the pid file");
}

#[test]
fn answers_every_corpus_query_as_the_desktops_own_client_did() {
    let (_, corpus) = need!();
    let scratch = tempfile::tempdir().unwrap();
    let queries: Vec<String> = serde_json::from_slice::<QueriesFile>(&fs::read(corpus.join("search-queries.json")).unwrap()).unwrap().groups.into_iter().flat_map(|g| g.queries).collect();
    let expected: Expected = serde_json::from_slice(&fs::read(corpus.join("search-expected.json")).unwrap()).unwrap();
    eprintln!("expected answers from Meilisearch {}", expected.meilisearch);

    let (mut meili, handle) = started(&scratch.path().join("state"));
    let index = NotesIndex::new(&handle.url, &handle.master_key);
    let (idle, _) = memory_kb(handle.pid);
    for size in ["100", "1000"] {
        let notes = notes_of(&corpus, size, scratch.path());
        let began = Instant::now();
        index.reindex_all(&notes).unwrap();
        let (rss, hwm) = memory_kb(handle.pid);
        eprintln!("{size} notes: reindexed in {:.0} ms; Meilisearch resident {} MB (high-water {} MB; {} MB right after start)", began.elapsed().as_secs_f64() * 1000.0, rss / 1024, hwm / 1024, idle / 1024);

        let answers: HashMap<&str, &Vec<i64>> = expected.corpora[size].results.iter().map(|a| (a.query.as_str(), &a.ids)).collect();
        let mut differ = vec![];
        let mut timings = vec![];
        for q in &queries {
            let t = Instant::now();
            let got = index.search_ids(q).unwrap();
            timings.push(t.elapsed().as_secs_f64() * 1000.0);
            if answers.get(q.as_str()).map(|w| **w != got).unwrap_or(false) {
                differ.push(format!("{q:?}: want {:?} got {got:?}", answers[q.as_str()]));
            }
        }
        timings.sort_by(|a, b| a.partial_cmp(b).unwrap());
        eprintln!("{size} notes: {} queries, {} differ from the committed answers; median {:.1} ms, slowest {:.1} ms", queries.len(), differ.len(), timings[timings.len() / 2], timings.last().unwrap());
        for d in differ.iter().take(8) {
            eprintln!("  {d}");
        }
        // The same engine, the same version, the same flags, settings and documents: the answers are not "close", they are the same.
        if expected.meilisearch == index.version().unwrap() {
            assert!(differ.is_empty(), "{} queries differ over {size} notes", differ.len());
        }
    }
    meili.stop();
}

#[test]
fn a_hard_kill_in_the_middle_of_indexing_then_a_start_then_a_search() {
    let (_, corpus) = need!();
    let scratch = tempfile::tempdir().unwrap();
    let state = scratch.path().join("state");
    let notes = notes_of(&corpus, "1000", scratch.path());

    let (mut meili, handle) = started(&state);
    let index = NotesIndex::new(&handle.url, &handle.master_key);
    index.ensure_index().unwrap();
    let tasks = index.enqueue_in_batches(&notes, 50).unwrap(); // twenty requests in flight, none waited for
    assert_eq!(tasks.len(), 20);
    meili.kill_hard(); // no terminate, no cleanup, the pid file left behind
    assert!(state.join("meili.pid").exists(), "a crash leaves its pid file");

    let (mut meili, handle) = started(&state); // same data folder: reaps nothing (already dead), finds the old files
    let index = NotesIndex::new(&handle.url, &handle.master_key);
    index.reindex_all(&notes[..100]).unwrap(); // what the app does at start: rebuild from SQLite
    let hits = index.search_ids("kubernetes").unwrap();
    assert!(!hits.is_empty(), "search works after the kill and the rebuild");
    eprintln!("after a hard kill mid-index: restarted, rebuilt, 'kubernetes' found {} notes", hits.len());
    meili.stop();
}

#[cfg(target_os = "linux")]
fn host(state: &Path, binary: &Path, no_pdeathsig: bool) -> (std::process::Child, u32) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_host"));
    command.arg(state).arg(binary).stdout(Stdio::piped());
    if no_pdeathsig {
        command.env("NO_PDEATHSIG", "1");
    }
    let mut child = command.spawn().unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    let pid = line.trim().strip_prefix("PID ").expect("the host printed the sidecar's pid").parse().unwrap();
    (child, pid)
}

#[cfg(target_os = "linux")]
#[test]
fn the_sidecar_dies_with_the_app_when_the_app_is_killed() {
    let (bin, _) = need!();
    let scratch = tempfile::tempdir().unwrap();
    let (mut app, sidecar) = host(scratch.path(), &bin, false);
    assert!(is_alive(sidecar as i32));
    app.kill().unwrap(); // SIGKILL: the app gets no chance to stop anything
    app.wait().unwrap();
    let began = Instant::now();
    while is_alive(sidecar as i32) && began.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    eprintln!("app killed; Meilisearch gone after {:.0} ms", began.elapsed().as_secs_f64() * 1000.0);
    assert!(!is_alive(sidecar as i32), "no orphan");
}

#[cfg(target_os = "linux")]
#[test]
fn without_that_the_next_start_reaps_the_orphan_by_its_pid_file() {
    let (bin, _) = need!();
    let scratch = tempfile::tempdir().unwrap();
    let (mut app, sidecar) = host(scratch.path(), &bin, true);
    app.kill().unwrap();
    app.wait().unwrap();
    std::thread::sleep(Duration::from_millis(500));
    assert!(is_alive(sidecar as i32), "with PDEATHSIG off the orphan outlives its app (this is the Electron app's situation)");
    let (mut meili, handle) = started(scratch.path()); // reaps it, then starts a fresh one
    assert!(!is_alive(sidecar as i32), "the new start killed the old one");
    assert_ne!(handle.pid, sidecar);
    meili.stop();
}
