# Search

Source: [`searchQuery.ts`](../../apps/web/src/lib/composition/searchQuery.ts),
[`searchIndex.ts`](../../apps/web/src/lib/composition/searchIndex.ts),
[`service.ts`](../../apps/web/src/lib/composition/service.ts) (`searchNotes`),
[`App.tsx`](../../apps/cli/src/App.tsx) (the terminal app's search bar),
[`runtime.ts`](../../apps/cli/src/runtime.ts) (starting Meilisearch),
[`meili.ts`](../../apps/desktop/src/main/meili.ts) (the process)

Search is fuzzy full-text search over titles, descriptions and content, plus structured filter
tokens (`tag:`, `title:`, `created:` …), served by a local Meilisearch index that is kept in sync
with SQLite on every write. The terminal, web and desktop apps all use the same query parser,
index shape and `searchNotes` function; they differ in who starts Meilisearch (below).

## Query flow (terminal app)

```mermaid
sequenceDiagram
    participant User
    participant App as App.tsx
    participant Svc as service.searchNotes
    participant Parse as parseSearchQuery
    participant Idx as searchIndex
    participant Meili as Meilisearch

    User->>App: types in the search bar
    App->>App: wait 350 ms after the last keystroke
    App->>Svc: searchNotes(query)
    Svc->>Idx: searchNoteIds(query)
    Idx->>Parse: parseSearchQuery(raw)
    Parse-->>Idx: { text, filters, attributesToSearchOn }
    Idx->>Meili: index.search(text, { filter, attributesToSearchOn, sort? })
    Meili-->>Idx: hits
    Idx-->>Svc: ids (de-duplicated, order kept)
    Svc-->>App: { hits } or { hits: [], error }
    App->>App: keep only the notes whose ids came back,<br/>rebuild the tree from them
```

A search never throws into the UI. If Meilisearch is down or was never started, `searchNotes`
returns `{ hits: [], error }` with the reason (for instance, that the binary wasn't found), the
terminal app shows it in its header and leaves the tree as it was. A search that is
still waiting when a newer one starts is discarded when it comes back, so slow answers cannot
overwrite fast ones.

While a search is filtering the tree, groups with no matching note below them are left out and
the Favorites section is hidden; with no match at all the tree says `No notes match.` An empty
search bar lists everything from SQLite, most recently edited first, without asking Meilisearch.

## Query syntax

`parseSearchQuery` is a pure function (no network), so it is safe to run on every debounced
keystroke. It recognizes `field: value` anywhere in the query, case-insensitive field names, space
after the colon optional, and treats everything else as free text:

| Field | Example | Matches |
|---|---|---|
| `tags:` / `tag:` | `tags: web development` | notes with exactly that tag (tag matching ignores case) |
| `title:` | `title: routng` | typo-tolerant search over titles only |
| `description:` | `description: ownership` | typo-tolerant search over descriptions only |
| `created:` / `createdAt:` / `createdOn:` | `created: >=2026-05-30` | creation date; operators `>`, `>=`, `<`, `<=`, `=` (default `=`, the whole UTC day) |
| `updated:` / `updatedAt:` / `updatedOn:` | `updated: <2026-01-01` | same, for the last-modified date |

- An unquoted value runs up to the next `field:` or the end of the query, so `tags: web development`
  is the one tag "web development". To follow a value with free text, put the text first
  (`async tags: web development`) or quote the value (`tags:"web development" async`).
- Repeating a field, or combining fields, ANDs them. `title:` and `description:` are the
  exception: Meilisearch can't scope individual words to an attribute, so their values and any
  free text are joined into one query over the named attributes.
- A field with no value yet (`tags:`) is ignored. A malformed date stays as literal text, so it
  finds nothing instead of silently dropping the constraint, and a half-typed date degrades to "no
  matches" rather than breaking the handler mid-keystroke.
- Results are capped at 50. A query with filters but no text lists matches newest first
  (`updated_at_ts:desc`).

(The Python CLI that preceded the terminal app understood only `tag:`, `title:` and `createdOn:`.)

## The index

One Meilisearch index, `notes`, with the note id as primary key and the title, description,
content, tags and creation and update times as documents. Title, content and description are
searchable; tags and the timestamps are filterable; the update time is sortable.

SQLite is the source of truth and the index is derived, so it can be thrown away and rebuilt at any
time:

- `searchIndex.reindexAll(notes)` empties it and re-adds every note. The terminal app does this
  in the background at every start (`SearchSidecar.start`, see [startup.md](startup.md)), and again
  after the data location changes.
- If the index has no documents, or the server was started fresh, the first search of a run
  rebuilds it, so a stale or empty index is never shown as "no matches". A document shape change
  (the `description` field was added) is handled the same way.

A note that owns a PDF is indexed with one more thing: the words of its PDF's marks (their quotes, comments and text notes) and its bookmarks' labels,
appended to its content (`marksSearchText`, [pdf.md](pdf.md#search)). A search returns ids only, so the added words are never shown; they only make
the note findable. A change to a mark or bookmark re-indexes the owner note afterwards, in the background; `reindexAll` adds them for every owner note
in one query. On the desktop, the text of the PDF itself is not indexed yet; on the iPad it is ([below](#the-text-of-a-pdf)).

## The text of a PDF

**On the iPad only, for now** (built 2026-11-12; the desktop is the next step, against the same oracle). A word that is only in a PDF's own pages,
never marked, finds the note that owns the PDF, and says on which page.

- **What is indexed.** Every page of every PDF a note owns, read with PDFKit (`PdfTextExtractor` in `CompositionPDF`, `PDFPage.string`) and
  put through one rule shared with the desktop: `pageSearchText` in [`pdfText.ts`](../../apps/web/src/lib/composition/pdfText.ts), ported as
  `PdfSearchText` in the Swift core. Line breaks become `\n`; compatibility forms become plain letters (NFKC: `ﬁ` is `fi`, full-width letters are
  letters); lines are trimmed and empty ones dropped; a soft hyphen is dropped except at a line's end; and a word broken over two lines with a
  hyphen (`extrac-` / `tion`, the next line starting in lower case) is also added whole, so `extraction` finds it (the halves still do too).
- **The oracle.** `fixtures/conformance/pdf-text.pdf` (eight awkward pages, made by `apps/ios/scripts/make-pdf-text-fixture.swift` with CoreText:
  ligature glyphs, hyphenation, accents, Greek and Cyrillic, full-width letters, two columns, a turned page, a page with no text, punctuation)
  is read by the desktop's pdf.js, with the reader's own options, through `pdfText.ts`; `apps/ios/scripts/pdf-text-oracle.mjs` writes what comes out
  to `fixtures/conformance/pdf-text.json`, with 55 more raw texts and what the rule makes of each. The Swift side must make the same text of
  every case exactly (`PdfTextConformanceTests`), PDFKit must find the same words on every page as pdf.js (`PdfTextExtractionTests`), and every
  one of those words must find the note at the first page it is on (`PdfTextConformanceTests`). `conformance.sh` checks the file is still what
  the desktop makes.
- **Where it is kept.** In the iPad's own index file, `search.db`, never in `composition.db` or a backup: it is derived from the files and
  can be read again. Three tables of its own: `pdf_files` (one row a PDF: its note, its file's SHA-256 and a state), `pdf_pages` (one row a
  page with text, with the printed page label when the PDF has its own) and `pdf_text_fts`, a contentless FTS5 table (`content=''`,
  `contentless_delete=1`, SQLite 3.43, so iOS 17) of the pages' text: the text is never read back, so it is not stored twice. The text is folded
  as a query is (case and accents, `Typo.fold`) before it goes in, because FTS5's `remove_diacritics` only takes accents off Latin letters
  (`Ζεύς` would not be found by `Ζεύς` otherwise; a note's own Greek or Cyrillic text has that problem today, which is a separate fix).
- **When it is read.** In the background (one PDF at a time, at utility priority, after anything already queued), when the notes open, after
  an import, and after a protected PDF is unlocked in the reader. `reconcilePdfText` compares what is kept with the `documents` table each
  time: a PDF that is gone, or whose file changed, is forgotten; a PDF never read is read. A rebuild of the notes' index (a restore, a stale
  fingerprint) does not throw the PDFs' text away. A search that is showing runs again when a PDF has been read.
- **States.** `indexed`; `noText` when no page had text, which is a scan (OCR is not built: the reader's Contents says *No searchable text
  (scanned)*, and only the PDF's marks and bookmarks find it); `locked` for a PDF that asks for a password, read the next time it is unlocked
  in the reader, with the password used for that reading only and never kept (the words are then in `search.db`, which has the iPad's own data
  protection and no other); `unreadable` when PDFKit cannot open it, not tried again until the file changes.
- **How a search uses it.** After the notes' own text: a note found by its title, text, description or its marks comes first, as before,
  and is listed once, without a page. Then the notes whose PDF has **every word of the query on one page** (the last word also as the start
  of a word, a quoted phrase as a phrase), most recently updated first, each with the first such page. There is **no typo tolerance** in a
  PDF's text: its words are kept out of the vocabulary the typo search reads on every keystroke, which a library of books would make hundreds
  of thousands of words long. `tag:` and date filters apply; `title:` and `description:` searches leave PDFs' text out. `searchHits` returns the
  page; `search` still returns ids, so the conformance tests against Meilisearch are unchanged.
- **How it is shown.** The result row says *In the PDF, p. 212* (the printed label when the PDF has one, else the page's number). Opening it
  opens the PDF at that page, marks where the words are on it, and shows the reader's find bar with them (the query's first phrase, or its
  longest word), for going on to the next.
- **What it costs.** A 600-page book of filler text (1.28 million characters) was read in 0.68 s and indexed in 0.19 s on a Mac, and grew
  the index by 387 KB; filler has a small vocabulary, so a real book's index is larger (more distinct words). Not yet measured on an iPad.
  Search time is unchanged for words the notes have; a query that reaches the PDFs' text costs one more FTS5 query.

The desktop's version is the next step: pdf.js's `getTextContent` per page in a utility process, `pageTextFromItems` and `pageSearchText`
from `pdfText.ts`, and **one Meilisearch document per page** (Meilisearch ignores every word past position 65,535 of a field, and a long book
has several hundred thousand), whose hits are mapped to their owner note.

```mermaid
sequenceDiagram
    participant Svc as service
    participant DB as SQLite
    participant Idx as searchIndex

    Note over Svc: createNote / saveNoteContent / restoreNote
    Svc->>DB: write the row
    Svc->>Idx: indexNote(note)
    Note over Svc,Idx: failures are logged and swallowed:<br/>indexing must never break a write

    Note over Svc: deleteNote (to the Trash Can)
    Svc->>DB: move the row to trashed_notes
    Svc->>Idx: deleteNoteFromIndex(id)
```

## Who runs Meilisearch

Each product keeps its own index, and none shares a Meilisearch data directory with another, so two
server processes never fight over one index:

| | Terminal app | Web app | Desktop app |
|---|---|---|---|
| Meilisearch | spawned by the app (`MeiliProcessManager`), random port | started by hand, `pnpm meili`, port 7700 | spawned by the app, bundled binary, random port |
| Binary | `meilisearch` on the `PATH`, or `COMPOSITION_MEILI_BIN` | the same, run by hand | bundled in the app |
| Data | `<app data>/meili_data` (default `~/.composition/meili_data`) | `~/.composition-web/meili_data` | under the app's own data folder |

The web app connects to `MEILI_URL` (default `http://127.0.0.1:7700`) with `MEILI_MASTER_KEY` or the
key file at `~/.composition/meili_master_key`. A search that can't reach Meilisearch comes back as an
error the UI shows, never as "No matches".

Developer tools for trying search against a throwaway index: `pnpm search:playground` in
`apps/cli` loads 100 dummy notes into a temporary database and Meilisearch of its own, and gives a
`search>` prompt; `pnpm seed` writes the same dummy notes into a scratch home you can open with
`COMPOSITION_DEV_HOME=<folder> pnpm dev`.
