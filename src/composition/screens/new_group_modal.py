"""Modal for creating a new group."""

from __future__ import annotations

from typing import ClassVar

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import ModalScreen
from textual.widgets import Input, Label

from composition.storage import Group, NotesStore


class NewGroupModal(ModalScreen[Group | None]):
    """Prompt for a group name; create it and hand back the new Group."""

    DEFAULT_CSS = """
    NewGroupModal {
        align: center middle;
    }
    NewGroupModal > Vertical {
        width: 60;
        height: auto;
        border: thick $primary;
        padding: 1 2;
        background: $surface;
    }
    """

    BINDINGS: ClassVar = [Binding("escape", "cancel", "Cancel", show=False)]

    def __init__(self, parent_id: int | None = None) -> None:
        super().__init__()
        self._parent_id = parent_id

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("New group name")
            yield Input(placeholder="Untitled Group", id="name-input")

    def on_mount(self) -> None:
        self.query_one("#name-input", Input).focus()

    @on(Input.Submitted, "#name-input")
    def create_group(self, event: Input.Submitted) -> None:
        name = event.value.strip() or "Untitled Group"
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        group = store.create_group(name, parent_id=self._parent_id)
        self.dismiss(group)

    def action_cancel(self) -> None:
        self.dismiss(None)
