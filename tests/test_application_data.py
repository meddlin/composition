import sqlite3
from pathlib import Path

import pytest

from composition.paths import ApplicationPaths
from composition.settings import (
    ApplicationDataMoveError,
    AppSettings,
    load_settings,
    move_application_data,
    save_settings,
    upgrade_legacy_application_data,
)


def _write_all_application_data(root, settings):
    paths = ApplicationPaths(root)
    root.mkdir(parents=True)
    paths.database.write_bytes(b"database")
    Path(f"{paths.database}-journal").write_bytes(b"journal")
    paths.meili_data.mkdir()
    (paths.meili_data / "data.ms").write_bytes(b"search data")
    paths.meili_log.write_text("log")
    paths.meili_master_key.write_text("secret")
    save_settings(settings, paths.settings)
    return paths


def test_move_application_data_moves_every_managed_file(tmp_path, monkeypatch):
    old_dir = tmp_path / "old"
    new_dir = tmp_path / "new"
    locator = tmp_path / "config" / "settings.yaml"
    monkeypatch.setattr("composition.settings.SETTINGS_PATH", locator)
    settings = AppSettings(app_data_dir=old_dir, theme="composition-forest")
    old_paths = _write_all_application_data(old_dir, settings)

    moved = move_application_data(settings, new_dir)

    new_paths = ApplicationPaths(new_dir)
    assert moved.app_data_dir == new_dir
    assert new_paths.database.read_bytes() == b"database"
    assert Path(f"{new_paths.database}-journal").read_bytes() == b"journal"
    assert (new_paths.meili_data / "data.ms").read_bytes() == b"search data"
    assert new_paths.meili_log.read_text() == "log"
    assert new_paths.meili_master_key.read_text() == "secret"
    assert load_settings(new_paths.settings) == moved
    assert load_settings(locator) == moved
    assert locator.is_symlink()
    assert not old_paths.database.exists()
    assert not Path(f"{old_paths.database}-journal").exists()
    assert not old_paths.meili_data.exists()
    assert not old_paths.settings.exists()
    assert not old_dir.exists()


def test_application_data_can_move_back_to_default_location(tmp_path, monkeypatch):
    default_dir = tmp_path / "default"
    custom_dir = tmp_path / "custom"
    monkeypatch.setattr(
        "composition.settings.SETTINGS_PATH", default_dir / "settings.yaml"
    )
    settings = AppSettings(app_data_dir=default_dir)
    _write_all_application_data(default_dir, settings)

    custom_settings = move_application_data(settings, custom_dir)
    restored_settings = move_application_data(custom_settings, default_dir)

    assert restored_settings.app_data_dir == default_dir
    assert not (default_dir / "settings.yaml").is_symlink()
    assert load_settings(default_dir / "settings.yaml") == restored_settings
    assert (default_dir / "composition.db").read_bytes() == b"database"
    assert not custom_dir.exists()


def test_existing_application_data_at_destination_is_not_overwritten(
    tmp_path, monkeypatch
):
    old_dir = tmp_path / "old"
    new_dir = tmp_path / "new"
    monkeypatch.setattr(
        "composition.settings.SETTINGS_PATH", tmp_path / "config" / "settings.yaml"
    )
    settings = AppSettings(app_data_dir=old_dir)
    old_paths = _write_all_application_data(old_dir, settings)
    new_dir.mkdir()
    (new_dir / "composition.db").write_bytes(b"existing")

    with pytest.raises(ApplicationDataMoveError, match="already contains"):
        move_application_data(settings, new_dir)

    assert old_paths.database.read_bytes() == b"database"
    assert (new_dir / "composition.db").read_bytes() == b"existing"


def test_destination_cannot_be_nested_inside_current_data(tmp_path, monkeypatch):
    old_dir = tmp_path / "old"
    monkeypatch.setattr(
        "composition.settings.SETTINGS_PATH", tmp_path / "config" / "settings.yaml"
    )
    settings = AppSettings(app_data_dir=old_dir)
    _write_all_application_data(old_dir, settings)

    with pytest.raises(ApplicationDataMoveError, match="cannot be inside"):
        move_application_data(settings, old_dir / "nested")


def test_failed_locator_update_rolls_data_back(tmp_path, monkeypatch):
    old_dir = tmp_path / "old"
    new_dir = tmp_path / "new"
    locator = tmp_path / "config" / "settings.yaml"
    monkeypatch.setattr("composition.settings.SETTINGS_PATH", locator)
    settings = AppSettings(app_data_dir=old_dir)
    old_paths = _write_all_application_data(old_dir, settings)

    def fail_to_update_locator(target):
        raise OSError("locator failed")

    monkeypatch.setattr(
        "composition.settings._update_settings_locator", fail_to_update_locator
    )

    with pytest.raises(ApplicationDataMoveError, match="locator failed"):
        move_application_data(settings, new_dir)

    assert old_paths.database.read_bytes() == b"database"
    assert (old_paths.meili_data / "data.ms").read_bytes() == b"search data"
    assert old_paths.settings.exists()
    assert not new_dir.exists()


def test_legacy_database_setting_consolidates_all_old_data(tmp_path, monkeypatch):
    default_dir = tmp_path / "default"
    custom_dir = tmp_path / "custom"
    locator = default_dir / "settings.yaml"
    monkeypatch.setattr("composition.settings.SETTINGS_PATH", locator)
    default_paths = ApplicationPaths(default_dir)
    default_paths.meili_data.mkdir(parents=True)
    (default_paths.meili_data / "data.ms").write_text("index")
    default_paths.meili_log.write_text("log")
    default_paths.meili_master_key.write_text("key")
    custom_dir.mkdir()
    legacy_database = custom_dir / "notes.db"
    legacy_database.write_bytes(b"notes")
    locator.write_text(f"db_path: {legacy_database}\ntheme: composition-light\n")

    upgraded = upgrade_legacy_application_data(load_settings(locator))

    assert upgraded.app_data_dir == custom_dir
    assert upgraded.theme == "composition-light"
    assert (custom_dir / "composition.db").read_bytes() == b"notes"
    assert (custom_dir / "meili_data" / "data.ms").read_text() == "index"
    assert (custom_dir / "settings.yaml").exists()
    assert not legacy_database.exists()
    assert not default_paths.meili_data.exists()
    assert locator.is_symlink()


def test_app_reopens_existing_database_after_move(tmp_path, monkeypatch):
    from _doubles import FakeSearchIndex

    from composition.app import CompositionApp

    old_dir = tmp_path / "old"
    new_dir = tmp_path / "new"
    locator = tmp_path / "config" / "settings.yaml"
    monkeypatch.setattr("composition.settings.SETTINGS_PATH", locator)
    monkeypatch.setattr(
        "composition.app.load_settings", lambda: AppSettings(app_data_dir=old_dir)
    )
    app = CompositionApp(search_index=FakeSearchIndex())
    note = app.notes_store.create_note("Moved note")

    app.move_application_data(new_dir)

    assert app.settings.app_data_dir == new_dir
    assert app.notes_store.get_note(note.id).title == "Moved note"
    assert not (old_dir / "composition.db").exists()
    assert (new_dir / "composition.db").exists()
    connection = sqlite3.connect(new_dir / "composition.db")
    assert connection.execute("SELECT title FROM notes").fetchone() == ("Moved note",)
    connection.close()
    app.notes_store.close()
