"""Persisted application settings, separate from the notes database."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from composition.storage import DEFAULT_DB_PATH
from composition.themes import DEFAULT_THEME, THEME_NAMES

SETTINGS_PATH = Path.home() / ".composition" / "settings.yaml"


@dataclass
class AppSettings:
    db_path: Path = DEFAULT_DB_PATH
    theme: str = DEFAULT_THEME


def load_settings(path: Path = SETTINGS_PATH) -> AppSettings:
    if not path.exists():
        return AppSettings()
    data = yaml.safe_load(path.read_text()) or {}
    theme = data.get("theme", DEFAULT_THEME)
    return AppSettings(
        db_path=Path(data.get("db_path", DEFAULT_DB_PATH)).expanduser(),
        theme=theme if theme in THEME_NAMES else DEFAULT_THEME,
    )


def save_settings(settings: AppSettings, path: Path = SETTINGS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"db_path": str(settings.db_path), "theme": settings.theme}
    path.write_text(yaml.safe_dump(data, sort_keys=False))
