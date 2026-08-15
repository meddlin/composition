"""Textual application shell for Composition."""

from typing import ClassVar

from textual.app import App
from textual.binding import Binding

from composition.screens import EditorScreen, MainScreen, NewNoteModal
from composition.storage import Note, NotesStore


class CompositionApp(App):
    """Composition: a terminal Markdown note-taking app."""

    TITLE = "Composition"
    BINDINGS: ClassVar = [
        Binding("ctrl+n", "new_note", "New Note"),
        Binding("q", "quit", "Quit"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.notes_store = NotesStore()

    def on_mount(self) -> None:
        self.push_screen(MainScreen())

    def action_new_note(self) -> None:
        def handle_result(note: Note | None) -> None:
            if note is not None:
                self.push_screen(EditorScreen(note))

        self.push_screen(NewNoteModal(), handle_result)

    def on_unmount(self) -> None:
        self.notes_store.close()


def main() -> None:
    CompositionApp().run()


if __name__ == "__main__":
    main()
