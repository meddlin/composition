//! The index: a file of its own, never part of `composition.db` (it is derived data that can be thrown away and rebuilt,
//! it must not change the schema the desktop shares, and a backup should not carry it). A port of the iPad's
//! `SearchIndex.swift`, whose ranking was measured against a real Meilisearch.
//!
//! How a query is answered:
//!   1. The text becomes words. Each is expanded to the words in the notes within its typo budget; the last one, being
//!      typed, also matches as the start of a longer word.
//!   2. Notes matching all the words come first, then all but the last word, and so on. Within those, no typos before one
//!      typo before two.
//!   3. Within each group, notes matching in the title come before notes matching in the text, then the rest by most
//!      recently updated.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection};

use super::query::{parse, DateField, ParsedSearchQuery, SearchFilter};
use super::typo::{self, fold, scalars, text_of, Rules};
use crate::timestamp::milliseconds_from_iso;

/// The most results a search returns, as on the desktop.
pub const RESULT_LIMIT: usize = 50;

/// The columns, most important first: the order Meilisearch's searchableAttributes put them in.
const COLUMNS: [&str; 3] = ["title", "content", "description"];

#[derive(Clone, Debug)]
pub struct IndexedNote {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub content: String,
    /// Comma-joined, the way the database stores them.
    pub tags: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tolerance {
    /// Exactly Meilisearch's rules: what the conformance run checks.
    MatchesMeilisearch,
    /// First-letter mistakes cost one, and a search that finds nothing is repeated allowing one mistake in 3-4 letter words.
    Forgiving,
}

impl Tolerance {
    fn rules(self) -> Rules {
        if self == Tolerance::Forgiving {
            Rules::FORGIVING
        } else {
            Rules::MEILISEARCH
        }
    }
    fn fallback(self) -> Option<Rules> {
        (self == Tolerance::Forgiving).then_some(Rules::FORGIVING_FALLBACK)
    }
}

pub struct SearchIndex {
    conn: Connection,
    tolerance: Tolerance,
    vocabulary: RefCell<Option<Vocabulary>>,
}

impl SearchIndex {
    pub fn open(path: &Path, tolerance: Tolerance) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, created_ts INTEGER NOT NULL, updated_ts INTEGER NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS doc_tags (id INTEGER NOT NULL, tag TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS idx_doc_tags ON doc_tags (tag, id);
             CREATE INDEX IF NOT EXISTS idx_doc_tags_id ON doc_tags (id);
             CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                 title, content, description, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4');
             CREATE VIRTUAL TABLE IF NOT EXISTS notes_vocab USING fts5vocab(notes_fts, 'row');",
        )?;
        Ok(Self { conn, tolerance, vocabulary: RefCell::new(None) })
    }

    /// Empties the index and fills it from every note in `database`.
    pub fn rebuild_from(&mut self, database: &Connection) -> rusqlite::Result<usize> {
        let mut stmt = database.prepare("SELECT id, title, description, content, tags, created_at, updated_at FROM notes ORDER BY id")?;
        let notes: Vec<IndexedNote> = stmt
            .query_map([], |r| {
                Ok(IndexedNote {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    description: r.get(2)?,
                    content: r.get(3)?,
                    tags: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let tx = self.conn.transaction()?;
        tx.execute_batch("DELETE FROM notes_fts; DELETE FROM docs; DELETE FROM doc_tags;")?;
        insert(&tx, &notes)?;
        tx.commit()?;
        *self.vocabulary.borrow_mut() = None;
        Ok(notes.len())
    }

    pub fn upsert(&mut self, notes: &[IndexedNote]) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        for n in notes {
            delete(&tx, n.id)?;
        }
        insert(&tx, notes)?;
        tx.commit()?;
        *self.vocabulary.borrow_mut() = None;
        Ok(())
    }

    pub fn remove(&mut self, ids: &[i64]) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        for id in ids {
            delete(&tx, *id)?;
        }
        tx.commit()?;
        *self.vocabulary.borrow_mut() = None;
        Ok(())
    }

    /// The ids of the notes matching `query`, best first, at most `RESULT_LIMIT`.
    pub fn search(&self, query: &str) -> rusqlite::Result<Vec<i64>> {
        let parsed = parse(query);
        if parsed.text.is_empty() && parsed.filters.is_empty() {
            return Ok(vec![]);
        }
        self.search_parsed(&parsed)
    }

    fn vocabulary(&self) -> rusqlite::Result<std::cell::Ref<'_, Vocabulary>> {
        if self.vocabulary.borrow().is_none() {
            let mut stmt = self.conn.prepare("SELECT term FROM notes_vocab")?;
            let terms: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
            *self.vocabulary.borrow_mut() = Some(Vocabulary::new(terms));
        }
        Ok(std::cell::Ref::map(self.vocabulary.borrow(), |v| v.as_ref().expect("just built")))
    }

    fn run(&self, sql: &str, params: Vec<Value>) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(params_from_iter(params), |r| r.get::<_, i64>(0))?;
        rows.collect()
    }

    fn search_parsed(&self, parsed: &ParsedSearchQuery) -> rusqlite::Result<Vec<i64>> {
        let mut conditions: Vec<String> = vec![];
        let mut arguments: Vec<Value> = vec![];
        for filter in &parsed.filters {
            match filter {
                SearchFilter::Tag(value) => {
                    conditions.push("EXISTS (SELECT 1 FROM doc_tags WHERE doc_tags.id = docs.id AND doc_tags.tag = ?)".into());
                    arguments.push(Value::Text(fold(value)));
                }
                SearchFilter::AtLeast(field, seconds) => {
                    conditions.push(format!("docs.{} >= ?", if *field == DateField::Created { "created_ts" } else { "updated_ts" }));
                    arguments.push(Value::Integer(*seconds));
                }
                SearchFilter::Before(field, seconds) => {
                    conditions.push(format!("docs.{} < ?", if *field == DateField::Created { "created_ts" } else { "updated_ts" }));
                    arguments.push(Value::Integer(*seconds));
                }
            }
        }
        let filter_sql: String = conditions.iter().map(|c| format!(" AND {c}")).collect();

        let terms = SearchTerms::new(&parsed.text);
        if terms.is_empty() {
            // Nothing to look for in the text: list what the filters allow, newest first.
            let sql = format!("SELECT id FROM docs WHERE 1 = 1{filter_sql} ORDER BY updated_ts DESC, updated_at DESC, id DESC LIMIT {RESULT_LIMIT}");
            return self.run(&sql, arguments);
        }

        let vocabulary = self.vocabulary()?;
        let allowed: Vec<String> = parsed.attributes.clone().unwrap_or_else(|| COLUMNS.iter().map(|s| s.to_string()).collect());
        // Matches in the most important column first, then the next, then in any of them together.
        let mut passes: Vec<String> = allowed[..allowed.len() - 1].iter().map(|c| format!("{{{c}}} : ")).collect();
        passes.push(format!("{{{}}} : ", allowed.join(" ")));
        let sql = format!(
            "SELECT notes_fts.rowid FROM notes_fts JOIN docs ON docs.id = notes_fts.rowid WHERE notes_fts MATCH ?{filter_sql} \
             ORDER BY docs.updated_at DESC, docs.id DESC LIMIT {RESULT_LIMIT}"
        );

        let last_is_prefix = terms.ends_with_word;
        let mut readings: Vec<Vec<Vec<u32>>> = vec![terms.words.clone()];
        if !terms.words.is_empty() {
            readings.extend(vocabulary.rewordings(&terms.words, last_is_prefix));
        }

        let answer = |rules: Rules| -> rusqlite::Result<Vec<i64>> {
            let mut found: Vec<i64> = vec![];
            let mut seen: HashSet<i64> = HashSet::new();
            for words in &readings {
                let expansions: Vec<Expansion> = words
                    .iter()
                    .enumerate()
                    .map(|(i, w)| vocabulary.expand(w, i == words.len() - 1 && last_is_prefix, rules))
                    .collect();
                // All the words, then all but the last, and so on; at each, no typos first. Phrases are never dropped.
                let counts: Vec<usize> = if words.is_empty() { vec![0] } else { (1..=words.len()).rev().collect() };
                for count in counts {
                    let used = &expansions[..count.min(expansions.len())];
                    let tiers = used.iter().map(|e| e.budget).max().unwrap_or(0).max(0);
                    let mut previous: Option<Vec<String>> = None;
                    for tier in 0..=tiers {
                        let mut units: Vec<String> = used.iter().map(|e| e.expression(tier)).collect();
                        units.extend(terms.phrases.iter().map(|p| phrase_expression(p)));
                        if previous.as_ref() == Some(&units) {
                            continue; // this tier added no new spelling to any word
                        }
                        previous = Some(units.clone());
                        for columns in &passes {
                            let matcher = format!("{columns}({})", units.join(" AND "));
                            let mut params = vec![Value::Text(matcher)];
                            params.extend(arguments.iter().cloned());
                            for id in self.run(&sql, params)? {
                                if seen.insert(id) {
                                    found.push(id);
                                    if found.len() == RESULT_LIMIT {
                                        return Ok(found);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(found)
        };

        let found = answer(self.tolerance.rules())?;
        // Nothing at all: read the short words as if one letter of each might be wrong, which is too noisy to do when
        // there is something to show.
        if found.is_empty() {
            if let Some(fallback) = self.tolerance.fallback() {
                return answer(fallback);
            }
        }
        Ok(found)
    }
}

fn delete(tx: &rusqlite::Transaction, id: i64) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM notes_fts WHERE rowid = ?1", [id])?;
    tx.execute("DELETE FROM docs WHERE id = ?1", [id])?;
    tx.execute("DELETE FROM doc_tags WHERE id = ?1", [id])?;
    Ok(())
}

fn seconds(iso: &str) -> i64 {
    // Math.floor(new Date(iso).getTime() / 1000)
    milliseconds_from_iso(iso).map(|ms| ms.div_euclid(1000)).unwrap_or(0)
}

fn insert(tx: &rusqlite::Transaction, notes: &[IndexedNote]) -> rusqlite::Result<()> {
    let mut fts = tx.prepare("INSERT INTO notes_fts (rowid, title, content, description) VALUES (?1, ?2, ?3, ?4)")?;
    let mut doc = tx.prepare("INSERT INTO docs (id, created_ts, updated_ts, updated_at) VALUES (?1, ?2, ?3, ?4)")?;
    let mut tag = tx.prepare("INSERT INTO doc_tags (id, tag) VALUES (?1, ?2)")?;
    for n in notes {
        fts.execute((n.id, &n.title, &n.content, &n.description))?;
        doc.execute((n.id, seconds(&n.created_at), seconds(&n.updated_at), &n.updated_at))?;
        // The desktop's `tagsFromString`: split on commas, trim, drop empties. Matched without regard to case or accents.
        for name in n.tags.split(',').map(str::trim).filter(|t| !t.is_empty()) {
            tag.execute((n.id, fold(name)))?;
        }
    }
    Ok(())
}

fn phrase_expression(words: &[String]) -> String {
    format!("\"{}\"", words.join(" "))
}

/// What the free text of a query asks for: words, and phrases that were in double quotes.
struct SearchTerms {
    words: Vec<Vec<u32>>,
    phrases: Vec<Vec<String>>,
    /// Whether the last thing typed is a word and not a closed phrase (only then is it also matched as a prefix).
    ends_with_word: bool,
}

impl SearchTerms {
    fn is_empty(&self) -> bool {
        self.words.is_empty() && self.phrases.is_empty()
    }

    fn new(text: &str) -> Self {
        let mut t = SearchTerms { words: vec![], phrases: vec![], ends_with_word: true };
        let mut rest = text;
        while !rest.is_empty() {
            if let Some(open) = rest.find('"') {
                t.words.extend(typo::words_in(&rest[..open]).iter().map(|w| scalars(w)));
                let after = &rest[open + 1..];
                let close = after.find('"');
                let inside = typo::words_in(&after[..close.unwrap_or(after.len())]);
                if !inside.is_empty() {
                    t.phrases.push(inside);
                    t.ends_with_word = false;
                }
                rest = close.map(|c| &after[c + 1..]).unwrap_or("");
            } else {
                let more: Vec<Vec<u32>> = typo::words_in(rest).iter().map(|w| scalars(w)).collect();
                if !more.is_empty() {
                    t.ends_with_word = true;
                }
                t.words.extend(more);
                rest = "";
            }
        }
        t
    }
}

/// A typed word's possible spellings: the words (or word starts) it may mean, each with its edit distance.
struct Expansion {
    word: String,
    is_prefix: bool,
    budget: i32,
    /// Spellings with their distance, nearest first.
    spellings: Vec<(String, i32)>,
}

impl Expansion {
    /// The FTS5 expression for this word at up to `limit` edits: the word as typed, plus the near spellings.
    fn expression(&self, limit: i32) -> String {
        let quote = |t: &str| if self.is_prefix { format!("\"{t}\"*") } else { format!("\"{t}\"") };
        let exact = quote(&self.word);
        if limit <= 0 {
            return exact;
        }
        let near: Vec<String> = self.spellings.iter().filter(|(t, d)| *d > 0 && *d <= limit && *t != self.word).map(|(t, _)| quote(t)).collect();
        if near.is_empty() {
            exact
        } else {
            format!("({})", std::iter::once(exact).chain(near).collect::<Vec<_>>().join(" OR "))
        }
    }
}

struct Entry {
    text: String,
    scalars: Vec<u32>,
}

/// The words in the notes, with the spellings a typed word may stand for.
struct Vocabulary {
    entries: Vec<Entry>,
    by_length: HashMap<usize, Vec<usize>>,
    terms: HashSet<String>,
    sorted_terms: Vec<String>,
}

impl Vocabulary {
    fn new(terms: Vec<String>) -> Self {
        let mut sorted_terms = terms.clone();
        sorted_terms.sort();
        let entries: Vec<Entry> = terms.iter().map(|t| Entry { text: t.clone(), scalars: scalars(t) }).collect();
        let mut by_length: HashMap<usize, Vec<usize>> = HashMap::new();
        for (i, e) in entries.iter().enumerate() {
            by_length.entry(e.scalars.len()).or_default().push(i);
        }
        Self { entries, by_length, terms: terms.into_iter().collect(), sorted_terms }
    }

    fn contains(&self, word: &[u32]) -> bool {
        self.terms.contains(&text_of(word))
    }

    fn has_word_starting_with(&self, start: &[u32]) -> bool {
        let prefix = text_of(start);
        let at = self.sorted_terms.partition_point(|t| t.as_str() < prefix.as_str());
        at < self.sorted_terms.len() && self.sorted_terms[at].starts_with(&prefix)
    }

    /// Other ways to read a list of words that Meilisearch also tries: two neighbouring words run together (`postgre sql`
    /// as `postgresql`), and a word cut in two (`nextjs` as `next js`). Only readings made of words the notes really have.
    fn rewordings(&self, words: &[Vec<u32>], last_is_prefix: bool) -> Vec<Vec<Vec<u32>>> {
        let mut variants: Vec<Vec<Vec<u32>>> = vec![];
        let last = words.len() - 1;
        for i in 0..words.len().saturating_sub(1) {
            let joined: Vec<u32> = words[i].iter().chain(words[i + 1].iter()).copied().collect();
            if self.contains(&joined) || (last_is_prefix && i + 1 == last && self.has_word_starting_with(&joined)) {
                let mut v: Vec<Vec<u32>> = words[..i].to_vec();
                v.push(joined);
                v.extend_from_slice(&words[i + 2..]);
                variants.push(v);
            }
        }
        for (i, word) in words.iter().enumerate().filter(|(_, w)| w.len() >= 4) {
            let is_last = last_is_prefix && i == last;
            if self.contains(word) || (is_last && self.has_word_starting_with(word)) {
                continue; // it is a word already
            }
            for cut in 2..=(word.len() - 2) {
                let (left, right) = (word[..cut].to_vec(), word[cut..].to_vec());
                if self.contains(&left) && (self.contains(&right) || (is_last && self.has_word_starting_with(&right))) {
                    let mut v: Vec<Vec<u32>> = words[..i].to_vec();
                    v.push(left);
                    v.push(right);
                    v.extend_from_slice(&words[i + 1..]);
                    variants.push(v);
                }
            }
        }
        variants.truncate(4);
        variants
    }

    fn expand(&self, word: &[u32], as_prefix: bool, rules: Rules) -> Expansion {
        let text = text_of(word);
        let budget = rules.budget(word.len());
        let first = rules.first_letter_cost;
        let mut spellings: Vec<(String, i32)> = vec![];
        if budget > 0 {
            if as_prefix {
                // Any word at least `word.len() - budget` long may begin with something near enough.
                let mut seen: HashSet<String> = HashSet::new();
                for (length, indexes) in &self.by_length {
                    if (*length as i32) + budget < word.len() as i32 {
                        continue;
                    }
                    for &index in indexes {
                        let entry = &self.entries[index];
                        let Some((distance, prefix_len)) = typo::prefix_distance(word, &entry.scalars, budget, first) else { continue };
                        let start = text_of(&entry.scalars[..prefix_len]);
                        if seen.insert(start.clone()) {
                            spellings.push((start, distance));
                        }
                    }
                }
            } else {
                let low = (word.len() as i32 - budget).max(1) as usize;
                for length in low..=(word.len() + budget as usize) {
                    for &index in self.by_length.get(&length).map(|v| v.as_slice()).unwrap_or(&[]) {
                        let entry = &self.entries[index];
                        if let Some(distance) = typo::distance(word, &entry.scalars, budget, first) {
                            spellings.push((entry.text.clone(), distance));
                        }
                    }
                }
            }
        }
        spellings.sort_by(|a, b| (a.1, &a.0).cmp(&(b.1, &b.0)));
        Expansion { word: text, is_prefix: as_prefix, budget, spellings }
    }
}
