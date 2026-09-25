"""Modal to confirm deleting a note."""

from __future__ import annotations

from typing import ClassVar

from textual import on
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import Button, Label


class ConfirmDeleteModal(ModalScreen[bool]):
    """Ask the user to confirm deleting a note; dismiss with True/False."""

    DEFAULT_CSS = """
    ConfirmDeleteModal {
        align: center middle;
    }
    ConfirmDeleteModal > Vertical {
        width: 60;
        height: auto;
        border: thick $error;
        padding: 1 2;
        background: $surface;
    }
    ConfirmDeleteModal #button-row {
        height: auto;
        align: right middle;
        padding-top: 1;
    }
    ConfirmDeleteModal Button {
        margin-left: 1;
    }
    """

    BINDINGS: ClassVar = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("n", "cancel", "No", show=False),
        Binding("y", "confirm", "Yes", show=False),
    ]

    def __init__(self, title: str) -> None:
        super().__init__()
        self._title = title

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(f'Delete "{self._title}"?')
            yield Label("This cannot be undone.")
            with Horizontal(id="button-row"):
                yield Button("Cancel", id="cancel-button")
                yield Button("Delete", id="delete-button", variant="error")

    def on_mount(self) -> None:
        self.query_one("#cancel-button", Button).focus()

    @on(Button.Pressed, "#delete-button")
    def confirm_button(self) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#cancel-button")
    def cancel_button(self) -> None:
        self.dismiss(False)

    def action_confirm(self) -> None:
        self.dismiss(True)

    def action_cancel(self) -> None:
        self.dismiss(False)
