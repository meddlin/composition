//! Full-text search with typo tolerance over SQLite FTS5: the replacement for the Meilisearch the desktop runs. A Rust
//! port of the iPad's Swift `Search/` folder, checked against the same Meilisearch answers (`search-expected.json`).

pub mod index;
pub mod query;
pub mod typo;

pub use index::{IndexedNote, SearchIndex, Tolerance};
pub use query::{parse, ParsedSearchQuery, SearchFilter};
