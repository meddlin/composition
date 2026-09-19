from composition.settings import AppSettings, load_settings, save_settings


def test_load_settings_defaults_when_file_missing(tmp_path):
    settings = load_settings(tmp_path / "settings.yaml")

    assert settings == AppSettings()


def test_save_then_load_round_trips_values(tmp_path):
    path = tmp_path / "settings.yaml"
    original = AppSettings(app_data_dir=tmp_path / "data")

    save_settings(original, path)
    loaded = load_settings(path)

    assert loaded == original
    assert "app_data_dir:" in path.read_text()
    assert "db_path:" not in path.read_text()


def test_save_settings_creates_parent_directory(tmp_path):
    path = tmp_path / "nested" / "settings.yaml"

    save_settings(AppSettings(app_data_dir=tmp_path / "data"), path)

    assert path.exists()


def test_theme_defaults_to_dark_when_key_missing(tmp_path):
    path = tmp_path / "settings.yaml"
    path.write_text("db_path: /tmp/notes.db\n")

    assert load_settings(path).theme == "textual-dark"


def test_theme_round_trips(tmp_path):
    path = tmp_path / "settings.yaml"

    save_settings(
        AppSettings(app_data_dir=tmp_path / "data", theme="composition-forest"), path
    )

    assert load_settings(path).theme == "composition-forest"


def test_unknown_theme_falls_back_to_default(tmp_path):
    path = tmp_path / "settings.yaml"
    path.write_text("theme: not-a-real-theme\n")

    assert load_settings(path).theme == "textual-dark"
