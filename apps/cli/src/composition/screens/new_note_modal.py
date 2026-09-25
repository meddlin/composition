"""Modal for creating a new note."""

from __future__ import annotations

from typing import ClassVar

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import ModalScreen
from textual.widgets import Input, Label

from composition.storage import Note, NotesStore


class NewNoteModal(ModalScreen[Note | None]):
    """Prompt for a note title; create it and hand back the new Note."""

    DEFAULT_CSS = """
    NewNoteModal {
        align: center middle;
    }
    NewNoteModal > Vertical {
        width: 60;
        height: auto;
        border: thick $primary;
        padding: 1 2;
        background: $surface;
    }
    """

    BINDINGS: ClassVar = [Binding("escape", "cancel", "Cancel", show=False)]

    def __init__(self, group_id: int | None = None) -> None:
        super().__init__()
        self._group_id = group_id

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("New note title")
            yield Input(placeholder="Untitled", id="title-input")

    def on_mount(self) -> None:
        self.query_one("#title-input", Input).focus()

    @on(Input.Submitted, "#title-input")
    def create_note(self, event: Input.Submitted) -> None:
        title = event.value.strip() or "Untitled"
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        note = store.create_note(title, group_id=self._group_id)
        self.dismiss(note)

    def action_cancel(self) -> None:
        self.dismiss(None)
