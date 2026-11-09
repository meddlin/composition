//! Prints what the linked SQLite can do. `cargo run --bin probe` (bundled) or with `--no-default-features` (system).
use composition_core_spike::pass::sqlite_facts;

fn main() {
    let conn = rusqlite::Connection::open_in_memory().expect("open");
    for line in sqlite_facts(&conn).expect("facts") {
        println!("{line}");
    }
}
