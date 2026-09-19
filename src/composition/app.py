"""Textual application shell for Composition."""

import sys
from typing import ClassVar

from textual.app import App
from textual.binding import Binding

from composition.screens import EditorScreen, MainScreen, NewNoteModal
from composition.search import (
    MeiliBinaryNotFoundError,
    MeiliProcessError,
    MeiliProcessManager,
    SearchIndex,
)
from composition.settings import AppSettings, load_settings
from composition.storage import Note, NotesStore
from composition.themes import CUSTOM_THEMES


class CompositionApp(App):
    """Composition: a terminal Markdown note-taking app."""

    TITLE = "Composition"
    BINDINGS: ClassVar = [
        Binding("ctrl+n", "new_note", "New Note"),
        Binding("q", "quit", "Quit"),
    ]

    def __init__(self, search_index: SearchIndex | None = None) -> None:
        super().__init__()
        self.settings: AppSettings = load_settings()
        for theme in CUSTOM_THEMES:
            self.register_theme(theme)
        self.theme = self.settings.theme
        self._meili_manager: MeiliProcessManager | None = None
        owns_process = search_index is None
        if search_index is None:
            self._meili_manager = MeiliProcessManager()
            handle = self._meili_manager.start()
            search_index = SearchIndex(url=handle.url, api_key=handle.master_key)
            search_index.ensure_index()

        self.search_index = search_index
        self.notes_store = NotesStore(
            db_path=self.settings.db_path, search_index=self.search_index
        )
        if owns_process:
            self.search_index.reindex_all(self.notes_store.list_notes())

    def on_mount(self) -> None:
        self.push_screen(MainScreen())

    def action_new_note(self) -> None:
        def handle_result(note: Note | None) -> None:
            if note is not None:
                self.push_screen(EditorScreen(note))

        group_id = None
        if isinstance(self.screen, MainScreen):
            group_id = self.screen.highlighted_group_id()

        self.push_screen(NewNoteModal(group_id), handle_result)

    def on_unmount(self) -> None:
        self.notes_store.close()
        if self._meili_manager is not None:
            self._meili_manager.stop()


def main() -> None:
    print("Starting local search server…", file=sys.stderr)
    try:
        app = CompositionApp()
    except (MeiliBinaryNotFoundError, MeiliProcessError) as exc:
        print(f"Composition failed to start: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    app.run()


if __name__ == "__main__":
    main()
