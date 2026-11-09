//! One Meilisearch index, "notes", with the note id as primary key and the title, description, content, tags and timestamps of
//! each note: `searchIndex.ts` in Rust. SQLite stays the source of truth; the index is derived and can be rebuilt at any time.

use std::time::{Duration, Instant};

use composition_core_spike::search::{parse, IndexedNote};
use composition_core_spike::timestamp::milliseconds_from_iso;
use serde_json::{json, Value};

const INDEX_UID: &str = "notes";
/// A filter-only query ("tags: x") should list every match, not just a first page.
const SEARCH_LIMIT: usize = 50;

#[derive(Debug)]
pub struct IndexError(pub String);

impl std::fmt::Display for IndexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for IndexError {}

type Result<T> = std::result::Result<T, IndexError>;

fn err(e: impl std::fmt::Display) -> IndexError {
    IndexError(e.to_string())
}

pub struct NotesIndex {
    agent: ureq::Agent,
    url: String,
    bearer: String,
}

/// `Math.floor(new Date(iso).getTime() / 1000)`; an unreadable date is JSON `null`, as `NaN` is in JavaScript.
fn to_timestamp(iso: &str) -> Value {
    milliseconds_from_iso(iso).map(|ms| json!(ms.div_euclid(1000))).unwrap_or(Value::Null)
}

/// `frontmatter.tagsFromString`: split on commas, trim, drop empties.
fn tags_from_string(tags: &str) -> Vec<&str> {
    tags.split(',').map(str::trim).filter(|t| !t.is_empty()).collect()
}

pub fn note_to_document(n: &IndexedNote) -> Value {
    json!({
        "id": n.id,
        "title": n.title,
        "description": n.description,
        "content": n.content,
        "tags": tags_from_string(&n.tags),
        "created_at_ts": to_timestamp(&n.created_at),
        "updated_at_ts": to_timestamp(&n.updated_at),
    })
}

impl NotesIndex {
    pub fn new(url: &str, master_key: &str) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(120))).http_status_as_error(false).no_delay(true).build().into();
        Self { agent, url: url.trim_end_matches('/').to_string(), bearer: format!("Bearer {master_key}") }
    }

    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value)> {
        let url = format!("{}{path}", self.url);
        let mut response = match (method, body) {
            ("GET", _) => self.agent.get(&url).header("Authorization", &self.bearer).call(),
            ("DELETE", _) => self.agent.delete(&url).header("Authorization", &self.bearer).call(),
            ("POST", Some(b)) => self.agent.post(&url).header("Authorization", &self.bearer).send_json(b),
            ("PATCH", Some(b)) => self.agent.patch(&url).header("Authorization", &self.bearer).send_json(b),
            _ => return Err(err(format!("unsupported call {method} {path}"))),
        }
        .map_err(err)?;
        let status = response.status().as_u16();
        let value = response.body_mut().read_json::<Value>().unwrap_or(Value::Null);
        Ok((status, value))
    }

    /// Waits for an enqueued task, as the JavaScript client's `waitTask` does; a task that did not succeed is an error.
    fn wait(&self, (status, enqueued): (u16, Value)) -> Result<()> {
        if status >= 400 {
            return Err(err(format!("Meilisearch said {status}: {enqueued}")));
        }
        let uid = enqueued["taskUid"].as_u64().ok_or_else(|| err(format!("no task in {enqueued}")))?;
        let started = Instant::now();
        loop {
            let (_, task) = self.call("GET", &format!("/tasks/{uid}"), None)?;
            match task["status"].as_str() {
                Some("succeeded") => return Ok(()),
                Some("failed") | Some("canceled") => return Err(err(format!("Meilisearch task failed: {}", task["error"]["message"]))),
                _ => {}
            }
            if started.elapsed() > Duration::from_secs(120) {
                return Err(err(format!("task {uid} did not finish")));
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Idempotent: creates the index with the id as primary key if it is missing, then sets what is searched, filtered and sorted.
    pub fn ensure_index(&self) -> Result<()> {
        let (status, _) = self.call("GET", &format!("/indexes/{INDEX_UID}"), None)?;
        if status == 404 {
            let created = self.call("POST", "/indexes", Some(&json!({ "uid": INDEX_UID, "primaryKey": "id" })))?;
            self.wait(created)?;
        }
        let settings = self.call(
            "PATCH",
            &format!("/indexes/{INDEX_UID}/settings"),
            Some(&json!({
                "searchableAttributes": ["title", "content", "description"],
                "filterableAttributes": ["tags", "created_at_ts", "updated_at_ts"],
                "sortableAttributes": ["updated_at_ts"],
            })),
        )?;
        self.wait(settings)
    }

    /// Enqueues one note and returns without waiting, as `indexNote` does.
    pub fn index_note(&self, note: &IndexedNote) -> Result<()> {
        let (status, body) = self.call("POST", &format!("/indexes/{INDEX_UID}/documents"), Some(&json!([note_to_document(note)])))?;
        if status >= 400 { Err(err(format!("{status}: {body}"))) } else { Ok(()) }
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        let (status, body) = self.call("DELETE", &format!("/indexes/{INDEX_UID}/documents/{id}"), None)?;
        if status >= 400 && status != 404 { Err(err(format!("{status}: {body}"))) } else { Ok(()) }
    }

    /// Empties the index and adds every note, waiting for both.
    pub fn reindex_all(&self, notes: &[IndexedNote]) -> Result<()> {
        self.ensure_index()?;
        let cleared = self.call("DELETE", &format!("/indexes/{INDEX_UID}/documents"), None)?;
        self.wait(cleared)?;
        if !notes.is_empty() {
            let docs: Vec<Value> = notes.iter().map(note_to_document).collect();
            let added = self.call("POST", &format!("/indexes/{INDEX_UID}/documents"), Some(&Value::Array(docs)))?;
            self.wait(added)?;
        }
        Ok(())
    }

    /// Like `reindex_all` but in several requests, none awaited until the end: what a kill mid-index interrupts.
    pub fn enqueue_in_batches(&self, notes: &[IndexedNote], batch: usize) -> Result<Vec<(u16, Value)>> {
        notes
            .chunks(batch)
            .map(|chunk| {
                let docs: Vec<Value> = chunk.iter().map(note_to_document).collect();
                self.call("POST", &format!("/indexes/{INDEX_UID}/documents"), Some(&Value::Array(docs)))
            })
            .collect()
    }

    pub fn wait_all(&self, tasks: Vec<(u16, Value)>) -> Result<()> {
        tasks.into_iter().try_for_each(|t| self.wait(t))
    }

    /// Ordered, de-duplicated note ids matching `query`, which may mix free text with `field: value` filters. A query with
    /// neither text nor filters has no hits.
    pub fn search_ids(&self, query: &str) -> Result<Vec<i64>> {
        let parsed = parse(query);
        if parsed.text.is_empty() && parsed.filters.is_empty() {
            return Ok(vec![]);
        }
        // `attributesToRetrieve` is not in the desktop's query (it fetches whole notes it then discards); asking for the id alone returns the
        // same hits in the same order with a response a hundred times smaller.
        let mut body = json!({ "q": parsed.text, "limit": SEARCH_LIMIT, "attributesToRetrieve": ["id"] });
        if !parsed.filters.is_empty() {
            body["filter"] = json!(parsed.filters.iter().map(|f| f.meilisearch_clause()).collect::<Vec<_>>().join(" AND "));
        }
        if let Some(attributes) = &parsed.attributes {
            body["attributesToSearchOn"] = json!(attributes);
        }
        // Without text there is no relevance to rank by; show the newest notes first.
        if parsed.text.is_empty() {
            body["sort"] = json!(["updated_at_ts:desc"]);
        }
        let (status, result) = self.call("POST", &format!("/indexes/{INDEX_UID}/search"), Some(&body))?;
        if status >= 400 {
            return Err(err(format!("search failed ({status}): {result}")));
        }
        let mut seen = std::collections::HashSet::new();
        Ok(result["hits"].as_array().into_iter().flatten().filter_map(|h| h["id"].as_i64()).filter(|id| seen.insert(*id)).collect())
    }

    pub fn version(&self) -> Result<String> {
        let (status, v) = self.call("GET", "/version", None)?;
        if status >= 400 { Err(err(format!("{status}: {v}"))) } else { Ok(v["pkgVersion"].as_str().unwrap_or("").to_string()) }
    }

    /// Whether the server answers without the key (it must not: production mode with a master key).
    pub fn answers_without_key(url: &str) -> bool {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        agent.get(&format!("{}/version", url.trim_end_matches('/'))).call().map(|r| r.status().as_u16() < 400).unwrap_or(false)
    }
}

/// The notes of a database in the order `listNotes()` returns them (`DISPLAY_ORDER` in notesRepo.ts), which is the order the desktop
/// feeds the index. **The order matters:** Meilisearch breaks ties between equally relevant notes by the order it was given the
/// documents, so a client that feeds them in another order (by id, say) returns the same notes in a different order.
pub fn load_notes(conn: &composition_core_spike::rusqlite::Connection) -> Vec<IndexedNote> {
    let mut stmt = conn
        .prepare("SELECT id, title, description, content, tags, created_at, updated_at FROM notes ORDER BY position IS NOT NULL, position, updated_at DESC, id DESC")
        .expect("prepare");
    stmt.query_map([], |r| {
        Ok(IndexedNote { id: r.get(0)?, title: r.get(1)?, description: r.get(2)?, content: r.get(3)?, tags: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)? })
    })
    .expect("query")
    .map(|r| r.expect("row"))
    .collect()
}
