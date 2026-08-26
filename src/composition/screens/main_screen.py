"""Main page: notes list + live Markdown preview."""

from __future__ import annotations

from typing import ClassVar

from textual import events
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, VerticalScroll
from textual.screen import Screen
from textual.timer import Timer
from textual.widgets import Footer, Header, Input, Label, ListItem, ListView, Markdown

from composition.screens.delete_note_modal import ConfirmDeleteModal
from composition.screens.editor_screen import EditorScreen
from composition.storage import Note, NotesStore

SEARCH_DEBOUNCE = 0.35  # seconds


class NoteListItem(ListItem):
    def __init__(self, note: Note) -> None:
        super().__init__(Label(note.title))
        self.note_id = note.id


class MainScreen(Screen):
    """Two-column notes list + preview, with a search bar above the list."""

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

    BINDINGS: ClassVar = [
        Binding("ctrl+d", "delete_note", "Delete Note"),
        Binding("ctrl+space", "focus_search", "Search"),
    ]

    # Without this, Textual's default AUTO_FOCUS ("*") would focus the search
    # Input first (it's composed before the list), and Input's own built-in
    # ctrl+d binding (delete-char-right) would shadow the screen's delete-note
    # action whenever nothing has been focused yet.
    AUTO_FOCUS = "#notes-list"

    def compose(self) -> ComposeResult:
        yield Header()
        yield Input(placeholder="Search… (tag: title: createdOn:)", id="search-input")
        with Horizontal(id="body"):
            yield ListView(id="notes-list")
            with VerticalScroll(id="preview-pane"):
                yield Markdown(id="preview")
        yield Footer()

    def on_mount(self) -> None:
        self._notes_by_id: dict[int, Note] = {}
        self._search_timer: Timer | None = None
        self._refresh_notes()

    def on_screen_resume(self, event: events.ScreenResume) -> None:
        if self._active_search_query():
            self._run_search()
        else:
            self._refresh_notes()

    def _active_search_query(self) -> str:
        return self.query_one("#search-input", Input).value.strip()

    def action_focus_search(self) -> None:
        self.query_one("#search-input", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id != "search-input":
            return
        if self._search_timer is not None:
            self._search_timer.stop()
        self._search_timer = self.set_timer(SEARCH_DEBOUNCE, self._run_search)

    def _run_search(self) -> None:
        self._search_timer = None
        query = self._active_search_query()
        if not query:
            self._refresh_notes()
            return

        search_index = self.app.search_index  # type: ignore[attr-defined]
        try:
            note_ids = search_index.search(query)
        except Exception:  # noqa: BLE001 - a flaky search must not crash the UI
            return

        notes = [self._notes_by_id[i] for i in note_ids if i in self._notes_by_id]
        self._populate_list(notes)

    def _refresh_notes(self) -> None:
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        notes = store.list_notes()
        self._notes_by_id = {note.id: note for note in notes}
        self._populate_list(notes)

    def _populate_list(self, notes: list[Note]) -> None:
        list_view = self.query_one("#notes-list", ListView)
        previous_id = self._highlighted_note_id(list_view)
        # Don't steal focus from the search input while the user is typing —
        # only Tab should move focus away from it.
        keep_search_focused = self.query_one("#search-input", Input).has_focus

        list_view.clear()
        for note in notes:
            list_view.append(NoteListItem(note))

        if not notes:
            self.query_one("#preview", Markdown).update(
                "*No notes yet — press Ctrl+N.*"
            )
            return

        restore_index = next((i for i, n in enumerate(notes) if n.id == previous_id), 0)
        list_view.index = restore_index
        if not keep_search_focused:
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
