"""Editing page: full-screen Markdown editor with debounced autosave."""

from __future__ import annotations

from typing import ClassVar

from textual.app import ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.timer import Timer
from textual.widgets import Footer, Header, TextArea

from composition.storage import Note, NotesStore

AUTOSAVE_DELAY = 0.5  # seconds


class EditorScreen(Screen):
    """Full-screen Markdown editor for a single note, with debounced autosave."""

    BINDINGS: ClassVar = [Binding("escape", "back", "Back to notes")]

    DEFAULT_CSS = """
    EditorScreen TextArea {
        border: none;
    }
    """

    def __init__(self, note: Note) -> None:
        super().__init__()
        self._note = note
        self._save_timer: Timer | None = None

    def compose(self) -> ComposeResult:
        yield Header()
        yield TextArea(
            self._note.content,
            language="markdown",
            soft_wrap=True,
            show_line_numbers=False,
        )
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = f"{self._note.title} — saved"
        self.query_one(TextArea).focus()

    def on_text_area_changed(self, event: TextArea.Changed) -> None:
        self.sub_title = f"{self._note.title} — saving…"
        if self._save_timer is not None:
            self._save_timer.stop()
        self._save_timer = self.set_timer(AUTOSAVE_DELAY, self._save)

    def _save(self) -> None:
        content = self.query_one(TextArea).text
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        store.update_note_content(self._note.id, content)
        self._note.content = content
        self.sub_title = f"{self._note.title} — saved"
        self._save_timer = None

    def action_back(self) -> None:
        if self._save_timer is not None:
            self._save_timer.stop()
            self._save_timer = None
            self._save()
        self.app.pop_screen()
