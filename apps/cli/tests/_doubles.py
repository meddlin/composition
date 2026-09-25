"""Shared test doubles for search-index dependents."""

from __future__ import annotations

from composition.storage import Note


class FakeSearchIndex:
    """Records index/delete calls; optionally supports substring search."""

    def __init__(self) -> None:
        self.indexed: list[Note] = []
        self.deleted: list[int] = []
        self._notes_by_id: dict[int, Note] = {}

    def index_note(self, note: Note) -> None:
        self.indexed.append(note)
        self._notes_by_id[note.id] = note

    def delete_note(self, note_id: int) -> None:
        self.deleted.append(note_id)
        self._notes_by_id.pop(note_id, None)

    def search(self, query_str: str) -> list[int]:
        needle = query_str.strip().lower()
        if not needle:
            return [note.id for note in self._notes_by_id.values()]
        matches = [
            note
            for note in self._notes_by_id.values()
            if needle in note.title.lower() or needle in note.content.lower()
        ]
        matches.sort(key=lambda note: note.updated_at, reverse=True)
        return [note.id for note in matches]
