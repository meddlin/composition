"""Modal for renaming an existing group."""

from __future__ import annotations

from typing import ClassVar

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import ModalScreen
from textual.widgets import Input, Label

from composition.storage import Group, NotesStore


class RenameGroupModal(ModalScreen[Group | None]):
    """Prompt pre-filled with a group's name; rename it and hand back the Group."""

    DEFAULT_CSS = """
    RenameGroupModal {
        align: center middle;
    }
    RenameGroupModal > Vertical {
        width: 60;
        height: auto;
        border: thick $primary;
        padding: 1 2;
        background: $surface;
    }
    """

    BINDINGS: ClassVar = [Binding("escape", "cancel", "Cancel", show=False)]

    def __init__(self, group: Group) -> None:
        super().__init__()
        self._group = group

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Rename group")
            yield Input(value=self._group.name, id="name-input")

    def on_mount(self) -> None:
        input_widget = self.query_one("#name-input", Input)
        input_widget.focus()
        input_widget.action_end()  # cursor after the pre-filled name, not before it

    @on(Input.Submitted, "#name-input")
    def rename_group(self, event: Input.Submitted) -> None:
        name = event.value.strip() or self._group.name
        store: NotesStore = self.app.notes_store  # type: ignore[attr-defined]
        store.rename_group(self._group.id, name)
        group = store.get_group(self._group.id)
        self.dismiss(group)

    def action_cancel(self) -> None:
        self.dismiss(None)
