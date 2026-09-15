# Note lifecycle: create, edit, autosave

Source: [`storage.py`](../../src/composition/storage.py),
[`frontmatter.py`](../../src/composition/frontmatter.py),
[`screens/editor_screen.py`](../../src/composition/screens/editor_screen.py),
[`screens/new_note_modal.py`](../../src/composition/screens/new_note_modal.py)

This is the most intricate flow in the app: every keystroke in the editor can, after a
debounce, round-trip through the YAML frontmatter parser before it reaches the
database. Understanding the two save paths below is the key to understanding the whole
metadata feature.

## Create

```mermaid
sequenceDiagram
    participant User
    participant Modal as NewNoteModal
    participant Store as NotesStore
    participant FM as frontmatter
    participant DB as SQLite
    participant Idx as SearchIndex

    User->>Modal: type title, press enter
    Modal->>Store: create_note(title)
    Store->>FM: generate(title, created_at=now, updated_at=now, tags=[])
    FM-->>Store: "---\ntitle: ...\n---\n"
    Store->>DB: INSERT notes(title, content, tags='', description='', ...)
    Store->>DB: get_note(new id)
    Store->>Idx: index_note(note)
    Store-->>Modal: Note
    Modal-->>User: dismiss(note) → EditorScreen(note) pushed
```

Every new note starts life with a generated frontmatter block already in its
`content` — there's never a note with zero frontmatter unless a user deliberately
deletes the block while editing.

## Autosave

`EditorScreen` debounces `TextArea.Changed` by 500ms (`AUTOSAVE_DELAY`) before calling
`_save()`. That method's job is to reconcile whatever frontmatter the user is currently
typing back into the `Note` object and the database — and it must never crash or lose
data, even if the user is mid-edit of the YAML block itself.

```mermaid
flowchart TD
    Change(["TextArea.Changed"]) --> Debounce["debounce 500ms<br/>(restart timer on each keystroke)"]
    Debounce --> Save["_save(): read TextArea.text"]
    Save --> Parse["frontmatter.parse(content)"]

    Parse -- "no leading '---' block,<br/>not a YAML mapping,<br/>or YAML error" --> Fallback["update_note_content(id, content)<br/><i>title / tags / description untouched</i>"]
    Parse -- "valid frontmatter" --> Reconcile["reconcile:<br/>title = parsed.title or previous<br/>created_at = parsed.created_at or previous<br/>updated_at = now_iso()"]

    Reconcile --> Render["frontmatter.render(reconciled, body)"]
    Render --> Sync["update_note(id, content,<br/>title=, tags=tags_to_string(parsed.tags), description=)"]

    Fallback --> Index["NotesStore._index(note) → SearchIndex.index_note"]
    Sync --> Index
    Index --> Done(["sub_title: '<title> — saved'"])
```

The two branches matter because a user can be in the middle of typing (or deleting)
the frontmatter block itself. Rather than guess at intent from half-typed YAML, the
fallback path leaves the DB's `title`/`tags`/`description` columns exactly as they
were and only persists the raw text — metadata resyncs automatically as soon as the
frontmatter becomes valid YAML again. This contract is pinned by
`test_update_note_syncs_title_tags_description_and_reindexes` and
`test_update_note_content_does_not_touch_title_tags_description` in
[`tests/test_storage.py`](../../tests/test_storage.py).

Pressing `escape` (`action_back`) flushes any pending debounced save immediately
before popping back to `MainScreen`, so navigating away never drops the last few
keystrokes.

## Which store method does what

| Method | When | Effect |
|---|---|---|
| `create_note(title, tags="")` | New note modal submits | Generates fresh frontmatter, inserts row, indexes. |
| `update_note(id, content, *, title, tags, description)` | Autosave, valid frontmatter | Full sync: content + all metadata columns, reindexes. |
| `update_note_content(id, content)` | Autosave, missing/malformed frontmatter | Content + `updated_at` only; metadata columns untouched. |
| `delete_note(id)` | Delete confirmed | Removes row, best-effort removes from search index. |
