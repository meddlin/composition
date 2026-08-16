"""SQLite-backed persistence for notes."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_DB_PATH = Path.home() / ".composition" / "composition.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


@dataclass
class Note:
    id: int
    title: str
    content: str
    created_at: str
    updated_at: str


class NotesStore:
    """Thin synchronous data-access layer over a single SQLite file."""

    def __init__(self, db_path: Path = DEFAULT_DB_PATH) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self._db_path)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute(_SCHEMA)
        self._connection.commit()

    def list_notes(self) -> list[Note]:
        """All notes, most-recently-edited first."""
        rows = self._connection.execute(
            "SELECT * FROM notes ORDER BY updated_at DESC"
        ).fetchall()
        return [Note(**row) for row in rows]

    def get_note(self, note_id: int) -> Note | None:
        row = self._connection.execute(
            "SELECT * FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
        return Note(**row) if row is not None else None

    def create_note(self, title: str) -> Note:
        now = _now()
        cursor = self._connection.execute(
            "INSERT INTO notes (title, content, created_at, updated_at) "
            "VALUES (?, '', ?, ?)",
            (title, now, now),
        )
        self._connection.commit()
        note = self.get_note(cursor.lastrowid)
        assert note is not None
        return note

    def update_note_content(self, note_id: int, content: str) -> None:
        self._connection.execute(
            "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
            (content, _now(), note_id),
        )
        self._connection.commit()

    def delete_note(self, note_id: int) -> None:
        self._connection.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        self._connection.commit()

    def close(self) -> None:
        self._connection.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()
