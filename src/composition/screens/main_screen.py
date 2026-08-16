"""Main page: notes list + live Markdown preview."""

from __future__ import annotations

from typing import ClassVar

from textual import events
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.screen import Screen
from textual.widgets import Footer, Header, Label, ListItem, ListView, Markdown

from composition.screens.delete_note_modal import ConfirmDeleteModal
from composition.screens.editor_screen import EditorScreen
from composition.storage import Note, NotesStore


class NoteListItem(ListItem):
    def __init__(self, note: Note) -> None:
        super().__init__(Label(note.title))
        self.note_id = note.id


class MainScreen(Screen):
    """Two-column notes list + preview."""

    DEFAULT_CSS = """
    MainScreen #body {
        height: 1fr;
    }
    MainScreen #notes-list {
        width: 34;
        border-right: solid $primary;
    }
    MainScreen #preview-pane {
        width: 1fr;
        padding: 1 2;
    }
    """

    BINDINGS: ClassVar = [Binding("ctrl+d", "delete_note", "Delete Note")]

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="body"):
            yield ListView(id="notes-list")
            with VerticalScroll(id="preview-pane"):
                yield Markdown(id="preview")
        yield Footer()

    def on_mount(self) -> None:
        self._notes_by_id: dict[int, Note] = {}
        self._refresh_notes()

    def on_screen_resume(self, event: events.ScreenResume) -> None:
        self._refresh_notes()

    def _refresh_notes(self) -> None:
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        list_view = self.query_one("#notes-list", ListView)
        previous_id = self._highlighted_note_id(list_view)

        list_view.clear()
        notes = store.list_notes()
        self._notes_by_id = {note.id: note for note in notes}
        for note in notes:
            list_view.append(NoteListItem(note))

        if not notes:
            self.query_one("#preview", Markdown).update(
                "*No notes yet — press Ctrl+N.*"
            )
            return

        restore_index = next((i for i, n in enumerate(notes) if n.id == previous_id), 0)
        list_view.index = restore_index
        list_view.focus()

    def _highlighted_note_id(self, list_view: ListView) -> int | None:
        item = list_view.highlighted_child
        return getattr(item, "note_id", None)

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        note_id = getattr(event.item, "note_id", None)
        note = self._notes_by_id.get(note_id) if note_id is not None else None
        preview = self.query_one("#preview", Markdown)
        preview.update(note.content if note else "")

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        note_id = getattr(event.item, "note_id", None)
        note = self._notes_by_id.get(note_id) if note_id is not None else None
        if note is not None:
            self.app.push_screen(EditorScreen(note))

    def action_delete_note(self) -> None:
        list_view = self.query_one("#notes-list", ListView)
        note_id = self._highlighted_note_id(list_view)
        if note_id is None:
            return

        note = self._notes_by_id[note_id]

        def handle_result(confirmed: bool | None) -> None:
            if confirmed:
                store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
                store.delete_note(note_id)
                self._refresh_notes()

        self.app.push_screen(ConfirmDeleteModal(note.title), handle_result)
