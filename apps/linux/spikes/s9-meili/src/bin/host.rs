//! A stand-in for the app, for the tests that kill it: starts the sidecar from its main thread, prints the sidecar's pid, and waits.
//! `host <state-dir> <meilisearch binary>`; `NO_PDEATHSIG=1` turns off the Linux-only "die with the parent" so the pid-file reaper is
//! what has to clean up.
use composition_meili_spike::supervisor::{MeiliOptions, MeiliProcess};

fn main() {
    let mut args = std::env::args().skip(1);
    let state = args.next().expect("state dir");
    let binary = args.next().expect("binary");
    let mut options = MeiliOptions::new(binary, state);
    options.die_with_parent = std::env::var_os("NO_PDEATHSIG").is_none();
    let mut meili = MeiliProcess::new(options);
    let handle = meili.start().expect("start");
    println!("PID {}", handle.pid);
    use std::io::Write;
    std::io::stdout().flush().ok();
    std::thread::sleep(std::time::Duration::from_secs(120));
}
