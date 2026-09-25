"""Parsing and generation of the YAML frontmatter block at the top of a note."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

import yaml

_FRONTMATTER_RE = re.compile(r"\A---\r?\n(?P<yaml>.*?)\r?\n---[ \t]*\r?\n?", re.DOTALL)


@dataclass
class Frontmatter:
    title: str = ""
    description: str = ""
    tags: list[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


def generate(
    title: str,
    *,
    created_at: str,
    updated_at: str,
    description: str = "",
    tags: list[str] | None = None,
) -> str:
    """Build a fresh '---\\n...\\n---\\n' block.

    Callers supply timestamps (storage.py owns the UTC-ISO "now" convention)
    so this module stays pure.
    """
    fm = Frontmatter(title, description, list(tags or []), created_at, updated_at)
    return _serialize(fm)


def parse(content: str) -> tuple[Frontmatter | None, str]:
    """Split content into (frontmatter, body).

    Returns (None, content) unchanged if there is no '---' block at the very
    top, the block isn't a YAML mapping, or the YAML fails to parse — this
    must never raise, since the block is free-form user-edited text.
    """
    match = _FRONTMATTER_RE.match(content)
    if match is None:
        return None, content
    try:
        data = yaml.safe_load(match.group("yaml"))
    except yaml.YAMLError:
        return None, content
    if not isinstance(data, dict):
        return None, content

    fm = Frontmatter(
        title=_as_str(data.get("title")),
        description=_as_str(data.get("description")),
        tags=_as_tag_list(data.get("tags")),
        created_at=_as_str(data.get("createdAt")),
        updated_at=_as_str(data.get("updatedAt")),
    )
    return fm, content[match.end() :]


def render(fm: Frontmatter, body: str) -> str:
    """Reassemble content from a (possibly edited) Frontmatter + body."""
    return _serialize(fm) + body


def strip(content: str) -> str:
    """Content with any leading frontmatter block removed, for the preview pane."""
    _, body = parse(content)
    return body


def tags_to_string(tags: list[str]) -> str:
    """YAML list -> DB's comma-joined tags string."""
    return ",".join(t.strip() for t in tags if t.strip())


def tags_from_string(tags: str) -> list[str]:
    """DB's comma-joined tags string -> YAML list."""
    return [t.strip() for t in tags.split(",") if t.strip()]


def _serialize(fm: Frontmatter) -> str:
    data = {
        "title": fm.title,
        "description": fm.description,
        "tags": list(fm.tags),
        "createdAt": fm.created_at,
        "updatedAt": fm.updated_at,
    }
    yaml_text = yaml.safe_dump(data, sort_keys=False, default_flow_style=False)
    return f"---\n{yaml_text}---\n"


def _as_str(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _as_tag_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        return tags_from_string(value)
    return []
