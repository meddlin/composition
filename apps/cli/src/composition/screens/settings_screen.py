"""Settings page: view/edit application data location and color scheme."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import ClassVar

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.screen import Screen
from textual.widgets import Footer, Header, Input, Label, RadioButton, RadioSet

from composition.settings import ApplicationDataMoveError, AppSettings, save_settings
from composition.themes import THEME_CHOICES


class SettingsScreen(Screen):
    """Full-screen editor for persisted application settings."""

    BINDINGS: ClassVar = [Binding("escape", "back", "Back to notes")]

    DEFAULT_CSS = """
    SettingsScreen > Vertical {
        width: 70;
        height: auto;
        padding: 1 2;
    }
    SettingsScreen Label {
        margin-top: 1;
    }
    """

    def compose(self) -> ComposeResult:
        settings: AppSettings = self.app.settings  # type: ignore[attr-defined]
        yield Header()
        with Vertical():
            yield Label("Application data location")
            yield Input(value=str(settings.app_data_dir), id="app-data-path-input")
            yield Label("Color scheme")
            with RadioSet(id="theme-set"):
                for label, name in THEME_CHOICES:
                    yield RadioButton(label, value=name == settings.theme, name=name)
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = "Settings"
        self.query_one("#app-data-path-input", Input).focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self._save()

    def on_radio_set_changed(self, event: RadioSet.Changed) -> None:
        name = event.pressed.name
        settings: AppSettings = self.app.settings  # type: ignore[attr-defined]
        if name is None or name == settings.theme:
            return
        self.app.theme = name
        # Replace only the theme so an unsubmitted data-path edit isn't saved.
        new_settings = replace(settings, theme=name)
        save_settings(new_settings)
        self.app.settings = new_settings  # type: ignore[attr-defined]

    def _save(self) -> None:
        settings: AppSettings = self.app.settings  # type: ignore[attr-defined]
        location = self.query_one("#app-data-path-input", Input).value.strip()
        if not location:
            self.notify("Application data location cannot be empty.", severity="error")
            return

        new_location = Path(location).expanduser().absolute()
        if new_location == settings.app_data_dir.absolute():
            save_settings(settings)
            self.notify("Settings saved.")
            return

        try:
            self.app.move_application_data(new_location)  # type: ignore[attr-defined]
        except ApplicationDataMoveError as exc:
            self.notify(str(exc), severity="error")
            return

        self.notify(f"Application data moved to {new_location}.")

    def action_back(self) -> None:
        self.app.pop_screen()
