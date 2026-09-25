import pytest
from _doubles import FakeSearchIndex
from textual.widgets import Input, Label, RadioSet

from composition.app import CompositionApp
from composition.screens.settings_screen import SettingsScreen
from composition.settings import AppSettings, load_settings
from composition.themes import THEME_CHOICES


@pytest.fixture
def settings_path(tmp_path, monkeypatch):
    path = tmp_path / "settings.yaml"
    monkeypatch.setattr("composition.settings.SETTINGS_PATH", path)
    monkeypatch.setattr(
        "composition.screens.settings_screen.save_settings",
        lambda settings: _save(settings, path),
    )
    return path


def _save(settings, path):
    from composition.settings import save_settings

    save_settings(settings, path)


def _make_app(tmp_path, monkeypatch, theme="textual-dark"):
    data_dir = tmp_path / "current"
    monkeypatch.setattr(
        "composition.app.load_settings",
        lambda: AppSettings(app_data_dir=data_dir, theme=theme),
    )
    return CompositionApp(search_index=FakeSearchIndex())


async def _open_settings(app, pilot):
    app.push_screen(SettingsScreen())
    await pilot.pause()
    return app.screen.query_one("#theme-set", RadioSet)


async def test_app_starts_with_saved_theme(tmp_path, monkeypatch):
    app = _make_app(tmp_path, monkeypatch, theme="composition-forest")

    async with app.run_test():
        assert app.theme == "composition-forest"


async def test_settings_lists_every_theme_with_current_one_selected(
    tmp_path, monkeypatch, settings_path
):
    app = _make_app(tmp_path, monkeypatch, theme="composition-light")

    async with app.run_test() as pilot:
        radio_set = await _open_settings(app, pilot)

        assert [b.name for b in radio_set.query("RadioButton")] == [
            name for _, name in THEME_CHOICES
        ]
        assert radio_set.pressed_button.name == "composition-light"
        # Opening the screen alone must not write anything.
        assert not settings_path.exists()


async def test_settings_labels_directory_as_application_data(tmp_path, monkeypatch):
    app = _make_app(tmp_path, monkeypatch)

    async with app.run_test() as pilot:
        await _open_settings(app, pilot)

        labels = [label.render().plain for label in app.screen.query(Label)]
        assert "Application data location" in labels


async def test_choosing_a_theme_applies_and_persists_it(
    tmp_path, monkeypatch, settings_path
):
    app = _make_app(tmp_path, monkeypatch)

    async with app.run_test() as pilot:
        radio_set = await _open_settings(app, pilot)

        radio_set.focus()
        await pilot.press("down", "enter")
        await pilot.pause()

        assert app.theme == "composition-light"
        assert app.settings.theme == "composition-light"
        assert load_settings(settings_path).theme == "composition-light"


async def test_choosing_a_theme_does_not_save_unsubmitted_data_path(
    tmp_path, monkeypatch, settings_path
):
    app = _make_app(tmp_path, monkeypatch)

    async with app.run_test() as pilot:
        radio_set = await _open_settings(app, pilot)
        app.screen.query_one("#app-data-path-input", Input).value = str(
            tmp_path / "other"
        )

        radio_set.focus()
        await pilot.press("down", "down", "enter")
        await pilot.pause()

        assert load_settings(settings_path).app_data_dir == tmp_path / "current"


async def test_saving_data_path_keeps_chosen_theme(
    tmp_path, monkeypatch, settings_path
):
    app = _make_app(tmp_path, monkeypatch, theme="composition-forest")

    async with app.run_test() as pilot:
        await _open_settings(app, pilot)
        path_input = app.screen.query_one("#app-data-path-input", Input)
        path_input.value = str(tmp_path / "other")
        path_input.focus()

        await pilot.press("enter")
        await pilot.pause()

        saved = load_settings(settings_path)
        assert saved.app_data_dir == tmp_path / "other"
        assert saved.theme == "composition-forest"
