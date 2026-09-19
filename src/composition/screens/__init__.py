"""Screens for the Composition TUI."""

from composition.screens.delete_note_modal import ConfirmDeleteModal
from composition.screens.editor_screen import EditorScreen
from composition.screens.main_screen import MainScreen
from composition.screens.new_group_modal import NewGroupModal
from composition.screens.new_note_modal import NewNoteModal
from composition.screens.rename_group_modal import RenameGroupModal
from composition.screens.select_group_modal import GroupSelection, SelectGroupModal
from composition.screens.settings_screen import SettingsScreen

__all__ = [
    "ConfirmDeleteModal",
    "EditorScreen",
    "GroupSelection",
    "MainScreen",
    "NewGroupModal",
    "NewNoteModal",
    "RenameGroupModal",
    "SelectGroupModal",
    "SettingsScreen",
]
