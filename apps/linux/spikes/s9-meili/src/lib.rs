//! A Rust twin of `apps/desktop/src/main/meili.ts` (the process) and `apps/web/src/lib/composition/searchIndex.ts` (the index).
//! Same flags, same environment, same key handling, same index settings, same document shape, same query shape; nothing is
//! invented. Where it does something the desktop does not (the child dies with its parent), it says so.

pub mod index;
pub mod supervisor;
