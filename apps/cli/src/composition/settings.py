"""Persist and relocate Composition's application data settings."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field, replace
from pathlib import Path

import yaml

from composition.paths import DEFAULT_APP_DATA_DIR, ApplicationPaths
from composition.themes import DEFAULT_THEME, THEME_NAMES

SETTINGS_PATH = ApplicationPaths(DEFAULT_APP_DATA_DIR).settings


class ApplicationDataMoveError(RuntimeError):
    """Raised when application data cannot safely be moved."""


@dataclass(frozen=True)
class AppSettings:
    app_data_dir: Path = DEFAULT_APP_DATA_DIR
    theme: str = DEFAULT_THEME
    # Set only while upgrading the old db_path-based settings format.
    _legacy_db_path: Path | None = field(default=None, repr=False, compare=False)

    @property
    def paths(self) -> ApplicationPaths:
        return ApplicationPaths(self.app_data_dir)

    @property
    def db_path(self) -> Path:
        """The database path, retained as a convenience for storage callers."""
        return self._legacy_db_path or self.paths.database


def load_settings(path: Path | None = None) -> AppSettings:
    settings_path = path or SETTINGS_PATH
    if not settings_path.exists():
        return AppSettings()

    data = yaml.safe_load(settings_path.read_text()) or {}
    theme = data.get("theme", DEFAULT_THEME)
    theme = theme if theme in THEME_NAMES else DEFAULT_THEME

    if "app_data_dir" in data:
        return AppSettings(
            app_data_dir=Path(data["app_data_dir"]).expanduser(), theme=theme
        )

    # Upgrade compatibility for settings written before application data shared
    # a single directory. The app moves the other legacy files before startup.
    legacy_db_path = Path(
        data.get("db_path", DEFAULT_APP_DATA_DIR / "composition.db")
    ).expanduser()
    return AppSettings(
        app_data_dir=legacy_db_path.parent,
        theme=theme,
        _legacy_db_path=legacy_db_path,
    )


def save_settings(settings: AppSettings, path: Path | None = None) -> None:
    settings_path = path or settings.paths.settings
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    data = {"app_data_dir": str(settings.app_data_dir), "theme": settings.theme}
    temporary_path = settings_path.with_name(f".{settings_path.name}.tmp")
    temporary_path.write_text(yaml.safe_dump(data, sort_keys=False))
    os.replace(temporary_path, settings_path)


def _same_path(left: Path, right: Path) -> bool:
    return left.absolute() == right.absolute()


def _is_within(path: Path, directory: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(directory.resolve(strict=False))
    except ValueError:
        return False
    return True


def _update_settings_locator(target: Path) -> None:
    """Point the well-known settings path at the settings file in use."""
    if _same_path(target, SETTINGS_PATH):
        return

    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_link = SETTINGS_PATH.with_name(f".{SETTINGS_PATH.name}.tmp-link")
    try:
        temporary_link.unlink(missing_ok=True)
        temporary_link.symlink_to(target.absolute())
        os.replace(temporary_link, SETTINGS_PATH)
    finally:
        temporary_link.unlink(missing_ok=True)


def _move_data(
    settings: AppSettings,
    destination: Path,
    *,
    source_paths: ApplicationPaths,
    source_database: Path,
    source_settings: Path,
) -> AppSettings:
    destination = destination.expanduser().absolute()
    destination_paths = ApplicationPaths(destination)
    new_settings = replace(
        settings,
        app_data_dir=destination,
        _legacy_db_path=None,
    )

    if destination.exists() and not destination.is_dir():
        raise ApplicationDataMoveError(
            f"Application data location is not a directory: {destination}"
        )

    moves = [
        (source_database, destination_paths.database),
        (Path(f"{source_database}-wal"), Path(f"{destination_paths.database}-wal")),
        (Path(f"{source_database}-shm"), Path(f"{destination_paths.database}-shm")),
        (
            Path(f"{source_database}-journal"),
            Path(f"{destination_paths.database}-journal"),
        ),
        (source_paths.meili_data, destination_paths.meili_data),
        (source_paths.meili_log, destination_paths.meili_log),
        (source_paths.meili_master_key, destination_paths.meili_master_key),
    ]
    moves = [
        (source, target)
        for source, target in moves
        if source.exists() and not _same_path(source, target)
    ]

    conflicts = [target for _, target in moves if target.exists()]
    if (
        destination_paths.settings.exists()
        and not _same_path(destination_paths.settings, source_settings)
        and not _same_path(destination_paths.settings, SETTINGS_PATH)
    ):
        conflicts.append(destination_paths.settings)
    if conflicts:
        paths = ", ".join(str(path) for path in conflicts)
        raise ApplicationDataMoveError(
            f"The new location already contains Composition data: {paths}"
        )

    destination_was_created = not destination.exists()
    target_settings_existed = (
        destination_paths.settings.exists() or destination_paths.settings.is_symlink()
    )
    destination.mkdir(parents=True, exist_ok=True)
    completed: list[tuple[Path, Path]] = []
    try:
        for source, target in moves:
            shutil.move(str(source), str(target))
            completed.append((source, target))
        save_settings(new_settings, destination_paths.settings)
        _update_settings_locator(destination_paths.settings)
    except Exception as exc:
        if not target_settings_existed:
            destination_paths.settings.unlink(missing_ok=True)
        for source, target in reversed(completed):
            if target.exists():
                source.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(target), str(source))
        if destination_was_created:
            try:
                destination.rmdir()
            except OSError:
                pass
        if isinstance(exc, ApplicationDataMoveError):
            raise
        raise ApplicationDataMoveError(
            f"Could not move application data: {exc}"
        ) from exc

    # The locator may have replaced a legacy settings file at SETTINGS_PATH.
    # A settings file elsewhere is now stale and should not be left as a copy.
    if not _same_path(source_settings, SETTINGS_PATH) and not _same_path(
        source_settings, destination_paths.settings
    ):
        source_settings.unlink(missing_ok=True)

    for old_directory in {source_database.parent, source_paths.root}:
        if old_directory != SETTINGS_PATH.parent:
            try:
                old_directory.rmdir()
            except OSError:
                pass

    return new_settings


def move_application_data(settings: AppSettings, destination: Path) -> AppSettings:
    """Move every managed application-data artifact into ``destination``."""
    source_paths = settings.paths
    destination = destination.expanduser().absolute()
    if _same_path(destination, source_paths.root):
        return settings
    if _is_within(destination, source_paths.root):
        raise ApplicationDataMoveError(
            "The new application data location cannot be inside the current one."
        )
    return _move_data(
        settings,
        destination,
        source_paths=source_paths,
        source_database=settings.db_path,
        source_settings=source_paths.settings,
    )


def upgrade_legacy_application_data(settings: AppSettings) -> AppSettings:
    """Consolidate data written by the old database-path-only configuration."""
    if settings._legacy_db_path is None:
        return settings

    legacy_paths = ApplicationPaths(SETTINGS_PATH.parent)
    return _move_data(
        settings,
        settings.app_data_dir,
        source_paths=legacy_paths,
        source_database=settings._legacy_db_path,
        source_settings=SETTINGS_PATH,
    )
