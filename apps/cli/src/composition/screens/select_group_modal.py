"""Modal for picking a group to move a note into."""

from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import ModalScreen
from textual.widgets import Label, ListItem, ListView

from composition.storage import Group


@dataclass
class GroupSelection:
    """The user's choice. group_id is None when 'Ungrouped' was picked."""

    group_id: int | None


class _GroupOption(ListItem):
    def __init__(self, label: str, group_id: int | None) -> None:
        super().__init__(Label(label))
        self.group_id = group_id


def _ordered_groups(groups: list[Group]) -> list[tuple[Group, int]]:
    """Groups in parent-before-child order, paired with nesting depth."""
    children_by_parent: dict[int | None, list[Group]] = {}
    for group in groups:
        children_by_parent.setdefault(group.parent_id, []).append(group)
    for children in children_by_parent.values():
        children.sort(key=lambda g: g.name)

    ordered: list[tuple[Group, int]] = []

    def visit(parent_id: int | None, depth: int) -> None:
        for group in children_by_parent.get(parent_id, []):
            ordered.append((group, depth))
            visit(group.id, depth + 1)

    visit(None, 0)
    return ordered


class SelectGroupModal(ModalScreen[GroupSelection | None]):
    """Pick a destination group (or Ungrouped) for a note."""

    DEFAULT_CSS = """
    SelectGroupModal {
        align: center middle;
    }
    SelectGroupModal > Vertical {
        width: 60;
        height: auto;
        max-height: 20;
        border: thick $primary;
        padding: 1 2;
        background: $surface;
    }
    """

    BINDINGS: ClassVar = [Binding("escape", "cancel", "Cancel", show=False)]

    def __init__(self, groups: list[Group]) -> None:
        super().__init__()
        self._groups = groups

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Move note to…")
            with ListView(id="group-options"):
                yield _GroupOption("Ungrouped", None)
                for group, depth in _ordered_groups(self._groups):
                    yield _GroupOption("  " * depth + group.name, group.id)

    def on_mount(self) -> None:
        self.query_one("#group-options", ListView).focus()

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        item = event.item
        assert isinstance(item, _GroupOption)
        self.dismiss(GroupSelection(group_id=item.group_id))

    def action_cancel(self) -> None:
        self.dismiss(None)
