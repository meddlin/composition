# S2: search (FTS5 with a typo layer, ported to Rust)

Run 2026-11-07. Code: `src/search/` (`query.rs`, `typo.rs`, `index.rs`), tests in `tests/search.rs`.

**Question.** Can SQLite FTS5 plus the iPad's typo layer, in Rust, meet the iPad's own acceptance bar against a real Meilisearch, so that
the Linux app could drop the sidecar?

**Answer: yes, at that bar, on the first run.** **The decision went the other way** (2026-11-07, the user): the native Linux app bundles
Meilisearch as the desktop does ([D5 in the design](../../../../docs/linux-native-app-design.md#decisions)), and [S9](../s9-meili/RESULT.md) proves that route. This note is
evidence only, and the parser result is needed either way.

## What was compared

The notes are the iPad's S2 corpus (`pnpm search:playground`'s generator, seed 42, 100 and 1,000 notes). Meilisearch's answers are the
committed `search-expected.json`, produced by a real Meilisearch 1.53.1 through the desktop's own `searchIndex.ts`. The 272 queries are
`search-queries.json`. The pass criteria are the iPad's, written before its first run and reused unchanged:

- **A** exact queries: the same set as Meilisearch wherever it returned fewer than the 50-result cap; on average 8 of its top 10 in ours
- **B** typo queries: nothing Meilisearch finds is missed
- **C** every query in under 200 ms on 1,000 notes

| | Result |
|---|---|
| Query parser (`parseSearchQuery`) | **272 of 272 queries** make the same text, filters and attributes as the desktop's |
| A, 100 notes | **159 of 159** same set; mean top-10 overlap **0.93** over the 74 queries with at least 10 results |
| B, 100 notes | **0 of 95** typo queries miss anything (including first-letter typos and typos in the word being typed) |
| C, 1,000 notes | 822 searches: median **0.1 ms**, 95th 0.3 to 0.4 ms, slowest **0.6 to 1.6 ms** over three runs on macOS arm64 (release); Ubuntu 24.04 arm64 container: median 0.1, slowest 0.3 (system SQLite). The bar is 200 ms |
| Index build | 100 notes 2 ms, 1,000 notes 13 to 15 ms |
| 1,000 notes, agreement | Set equal wherever uncapped; most queries hit the cap of 50, so top-10 overlap is 73 % overall (ties broken by recency, not by Meilisearch's order). Not an acceptance criterion |

## What this does and does not show

- It reproduces the **iPad's** result in a second language. The port is of the iPad's algorithm, so agreement with Meilisearch is the
  iPad's agreement, not an independent one.
- Meilisearch's ranking was matched by measurement (`TypoMatching.swift`'s comment says how). Where a note's text differs in ways the
  corpus does not (very long notes, non-Latin text, CJK), nothing here says.
- `fold()` uses Unicode NFD and drops combining marks; SQLite's `unicode61 remove_diacritics 2` can differ on a few letters. The corpus
  does not exercise them.
- Memory of the index was not measured.

## If the Linux app ever takes this route

The index is a file of its own (never part of `composition.db`), rebuilt when stale; the iPad's `notesFingerprint` and the upsert and
remove hooks are the part not ported here. Keeping it in step costs the same hooks the desktop already calls for Meilisearch.
