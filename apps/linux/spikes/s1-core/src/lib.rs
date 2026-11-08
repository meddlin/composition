//! The headless core of a native Linux Composition app, as a spike: no GTK, no async runtime.
//! It does what `apps/web/src/lib/composition/db.ts`, `backup.ts` and the search index do, in Rust, and is checked
//! against the same conformance files as the iPad's Swift core (see `tests/` and `tools/`).

/// Re-exported so the crates built on the core name the same `rusqlite` it links.
pub use rusqlite;

pub mod backup;
pub mod pass;
pub mod schema;
pub mod search;
pub mod timestamp;
