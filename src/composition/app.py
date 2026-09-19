"""Textual application shell for Composition."""

import sys
from pathlib import Path
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
from composition.settings import (
    ApplicationDataMoveError,
    AppSettings,
    load_settings,
    move_application_data,
    upgrade_legacy_application_data,
)
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
        self.settings: AppSettings = upgrade_legacy_application_data(load_settings())
        for theme in CUSTOM_THEMES:
            self.register_theme(theme)
        self.theme = self.settings.theme
        self._owns_search_process = search_index is None
        self._meili_manager: MeiliProcessManager | None = None
        self.search_index = search_index
        self._start_data_services()

    def _start_data_services(self) -> None:
        if self._owns_search_process:
            paths = self.settings.paths
            self._meili_manager = MeiliProcessManager(
                data_dir=paths.meili_data,
                log_path=paths.meili_log,
                key_path=paths.meili_master_key,
            )
            handle = self._meili_manager.start()
            self.search_index = SearchIndex(url=handle.url, api_key=handle.master_key)
            self.search_index.ensure_index()

        self.notes_store = NotesStore(
            db_path=self.settings.paths.database, search_index=self.search_index
        )
        if self._owns_search_process:
            self.search_index.reindex_all(self.notes_store.list_notes())

    def move_application_data(self, destination: Path) -> None:
        """Stop file users, move all application data, and reopen it in place."""
        old_settings = self.settings
        self.notes_store.close()
        if self._meili_manager is not None:
            self._meili_manager.stop()

        try:
            self.settings = move_application_data(old_settings, destination)
        except Exception:
            self.settings = old_settings
            self._start_data_services()
            raise

        self._start_data_services()

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
    except (
        ApplicationDataMoveError,
        MeiliBinaryNotFoundError,
        MeiliProcessError,
    ) as exc:
        print(f"Composition failed to start: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    app.run()


if __name__ == "__main__":
    main()
