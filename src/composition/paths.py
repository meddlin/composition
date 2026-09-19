"""Paths for the files that make up Composition's application data."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_APP_DATA_DIR = Path.home() / ".composition"


@dataclass(frozen=True)
class ApplicationPaths:
    """All persistent files owned by Composition under one directory."""

    root: Path

    @property
    def database(self) -> Path:
        return self.root / "composition.db"

    @property
    def meili_data(self) -> Path:
        return self.root / "meili_data"

    @property
    def meili_log(self) -> Path:
        return self.root / "meili.log"

    @property
    def meili_master_key(self) -> Path:
        return self.root / "meili_master_key"

    @property
    def settings(self) -> Path:
        return self.root / "settings.yaml"
