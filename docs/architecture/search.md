# Search

Source: [`search.py`](../../apps/cli/src/composition/search.py),
[`screens/main_screen.py`](../../apps/cli/src/composition/screens/main_screen.py),
[`storage.py`](../../apps/cli/src/composition/storage.py)

Search is fuzzy full-text search over titles and content, plus structured filter
tokens (`tag:`, `title:`, `createdOn:`), served by a local Meilisearch index that
`NotesStore` keeps in sync with SQLite on every write.

## Query flow

```mermaid
sequenceDiagram
    participant User
    participant Main as MainScreen
    participant Parse as parse_search_query
    participant Idx as SearchIndex
    participant Meili as Meilisearch

    User->>Main: types in #search-input
    Main->>Main: on_input_changed → debounce 350ms
    Main->>Idx: search_index.search(query)
    Idx->>Parse: parse_search_query(raw)
    Parse-->>Idx: ParsedQuery(text, filters, attributes_to_search_on)
    Idx->>Meili: index.search(text, {filter, attributesToSearchOn, sort?})
    Meili-->>Idx: hits
    Idx-->>Main: [note_id, ...] (deduped, order preserved)
    Main->>Main: map ids -> already-loaded Note objects
    Main->>Main: _populate_list(matched notes)
```

If `search_index.search()` raises for any reason, `MainScreen._run_search` swallows
the exception and leaves the list as-is — a flaky or restarting search backend
degrades to "stale results" rather than crashing the UI.

When the query is empty, `MainScreen` skips search entirely and calls
`_refresh_notes()`, which lists straight from SQLite ordered by `updated_at DESC`.

## Query syntax

`parse_search_query` (a pure function, no network calls) recognizes filter tokens
anywhere in the string and treats everything else as free text:

| Token | Example | Becomes |
|---|---|---|
| `tag:<value>` | `tag:software` | Meilisearch filter `tags = "software"` |
| `title:<value>` | `title:Next.js` | Narrows `attributesToSearchOn` to `["title"]`; value also joins the free-text query |
| `createdOn:[op]<date>` | `createdOn:>=2026-05-30` | Filter on `created_at_ts`; `op` is one of `>`, `>=`, `<`, `<=`, `=` (default `=`, matching the whole day) |

Multiple filter tokens combine with `AND`. A malformed `createdOn:` date (fails the
`YYYY-MM-DD` pattern) is left in place as literal search text instead of raising, so a
half-typed date degrades to "no matches" rather than breaking the debounced handler
mid-keystroke.

## Keeping the index in sync

SQLite is the source of truth; Meilisearch holds a derived index that `NotesStore`
pushes to on every mutation:

```mermaid
sequenceDiagram
    participant Store as NotesStore
    participant DB as SQLite
    participant Idx as SearchIndex

    Note over Store: create_note / update_note / update_note_content
    Store->>DB: write row
    Store->>Store: _index(note)
    Store->>Idx: index_note(note)
    Note over Store,Idx: exceptions are caught and logged to stderr —<br/>indexing must never break a storage write

    Note over Store: delete_note
    Store->>DB: DELETE row
    Store->>Idx: delete_note(note_id)
```

## Web app

The web app ([`searchIndex.ts`](../../apps/web/src/lib/composition/searchIndex.ts),
[`SearchBar.tsx`](../../apps/web/src/components/notes/SearchBar.tsx)) uses the same
`notes` index, document shape and settings. It connects to the Meilisearch at
`MEILI_URL` (default `http://127.0.0.1:7700`) with `MEILI_MASTER_KEY` or the key file
at `~/.composition/meili_master_key`. `pnpm meili` (in `apps/web`) starts one with its
own data dir, `~/.composition-web/meili_data`; the CLI's subprocess uses a random port
and `~/.composition/meili_data`, so the two do not share an index (each is rebuilt from
SQLite).

- The search bar debounces typing by 350 ms (same as the CLI), then calls the
  `searchNotes` server action, which maps hit ids back to SQLite rows. An unreachable
  Meilisearch comes back as an `error` the dropdown shows, not as "No matches".
- `saveNoteContent`, `createNote`, `deleteNote` and `restoreNote` push to the index
  best-effort: failures are logged and swallowed, like `NotesStore._index`. In the web
  and desktop apps `deleteNote` moves the note to the Trash Can, which takes it out of
  the index; `restoreNote` puts it back.
- If the index has no documents, the first search rebuilds it from SQLite.
- The query goes through [`searchQuery.ts`](../../apps/web/src/lib/composition/searchQuery.ts),
  a port of `parse_search_query` that understands every frontmatter field (below).
- Documents also carry `description`, which is searchable. Because that changes the
  document shape, the first search after the server starts rebuilds the index from
  SQLite (`reindexAll` also counts), so an index built by an older version isn't
  left without it.
- Results are capped at 50. A query with filters but no text lists matches newest
  first (`updated_at_ts:desc`).

### Filter syntax (web and desktop)

`field: value` anywhere in the query, case-insensitive field names, space after the
colon optional:

| Field | Example | Matches |
|---|---|---|
| `tags:` / `tag:` | `tags: web development` | notes with exactly that tag (tag matching ignores case) |
| `title:` | `title: routng` | typo-tolerant search over titles only |
| `description:` | `description: ownership` | typo-tolerant search over descriptions only |
| `created:` / `createdAt:` / `createdOn:` | `created: >=2026-05-30` | creation date; operators `>`, `>=`, `<`, `<=`, `=` (default `=`, the whole UTC day) |
| `updated:` / `updatedAt:` / `updatedOn:` | `updated: <2026-01-01` | same, for the last-modified date |

- An unquoted value runs up to the next `field:` or the end of the query, so
  `tags: web development` is the one tag "web development". To follow a value with
  free text, put the text first (`async tags: web development`) or quote the value
  (`tags:"web development" async`).
- Repeating a field, or combining fields, ANDs them. `title:` and `description:`
  are the exception: Meilisearch can't scope individual words to an attribute, so
  their values and any free text are joined into one query over the named
  attributes.
- A field with no value yet (`tags:`) is ignored. A malformed date stays as literal
  text, so it finds nothing instead of silently dropping the constraint.

Because the index is fully derived, `SearchIndex.reindex_all(notes)` can blow it away
and rebuild it from the SQLite rows at any time — this runs once at startup (see
[startup.md](startup.md)) and is the same mechanism `apps/cli/scripts/search_playground.py`
uses to exercise search against a throwaway index.
