"""Loads a temporary test dataset into SQLite + Meilisearch and lets you
interactively try fuzzy search queries against it.

Creates a temporary SQLite database and a temporary, isolated Meilisearch
instance (own data dir, own dynamically-allocated port), loads 100 generated
notes, then drops into a `search>` prompt. On exit, everything it created is
torn down: the Meilisearch subprocess is stopped and the temp directory
(SQLite file + Meili data dir) is removed.

Usage:
    uv run python scripts/search_playground.py
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from generate_dummy_notes import generate_notes

from composition.search import MeiliProcessManager, SearchIndex
from composition.storage import NotesStore


def _backdate(store: NotesStore, note_id: int, created_at: str) -> None:
    """Test-utility-only: there's no public API for setting created_at,
    since real note creation always stamps 'now'. We reach into the
    connection directly here to spread the dummy dataset over time so
    createdOn: filters have something meaningful to filter against.
    """
    store._connection.execute(
        "UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?",
        (created_at, created_at, note_id),
    )
    store._connection.commit()


def main() -> None:
    tmp_dir = Path(tempfile.mkdtemp(prefix="composition-search-playground-"))
    db_path = tmp_dir / "playground.db"
    manager = MeiliProcessManager(
        data_dir=tmp_dir / "meili_data",
        log_path=tmp_dir / "meili.log",
        key_path=tmp_dir / "meili_master_key",
    )

    print(f"Temp dir: {tmp_dir}")
    print("Starting temporary Meilisearch instance…")

    try:
        handle = manager.start()
        search_index = SearchIndex(url=handle.url, api_key=handle.master_key)
        search_index.ensure_index()
        store = NotesStore(db_path, search_index=search_index)

        print("Loading 100 dummy notes…")
        for dummy in generate_notes(count=100):
            note = store.create_note(dummy.title, tags=dummy.tags)
            store.update_note_content(note.id, dummy.content)
            _backdate(store, note.id, dummy.created_at)
            search_index.index_note(store.get_note(note.id))

        print("Indexed 100 notes. Try queries like:")
        print("  sofware              (typo fuzzy match)")
        print("  tag: software")
        print("  title: Next.js")
        print("  createdOn: >2026-05-30")
        print("  tag: infra createdOn: >=2026-01-01 roadmap")
        print()

        while True:
            try:
                query = input("search> ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not query:
                break

            ids = search_index.search(query)
            if not ids:
                print("  (no results)")
                continue
            for note_id in ids[:20]:
                note = store.get_note(note_id)
                if note is None:
                    continue
                print(
                    f"  [{note.id}] {note.title!r} tags={note.tags!r} created_at={note.created_at}"
                )

        store.close()
    finally:
        manager.stop()
        shutil.rmtree(tmp_dir, ignore_errors=True)
        print("Cleaned up temp database and Meilisearch instance.")


if __name__ == "__main__":
    main()
