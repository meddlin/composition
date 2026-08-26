"""Meilisearch-backed full-text search over notes.

SQLite (see storage.py) remains the source of truth; this module keeps a
derived, rebuildable Meilisearch index in sync with it.
"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import socket
import subprocess
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import meilisearch
from meilisearch.errors import MeilisearchApiError, MeilisearchCommunicationError

from composition.storage import Note

DEFAULT_MEILI_DATA_DIR = Path.home() / ".composition" / "meili_data"
DEFAULT_MEILI_LOG_PATH = Path.home() / ".composition" / "meili.log"
DEFAULT_MEILI_KEY_PATH = Path.home() / ".composition" / "meili_master_key"
DEFAULT_INDEX_UID = "notes"

_FILTER_TOKEN_RE = re.compile(
    r'(?P<key>tag|createdOn|title):\s*(?:"(?P<qval>[^"]*)"|(?P<val>\S+))'
)
_DATE_RE = re.compile(r"^(?P<op>>=|<=|>|<|=)?(?P<date>\d{4}-\d{2}-\d{2})$")


# --------------------------------------------------------------------------
# Query parsing (pure, no network dependency)
# --------------------------------------------------------------------------


@dataclass
class ParsedQuery:
    text: str
    filters: list[str] = field(default_factory=list)
    attributes_to_search_on: list[str] | None = None


def _escape_filter_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _day_bounds_ts(day: date) -> tuple[int, int]:
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    start_ts = int(start.timestamp())
    end_ts = int((start + timedelta(days=1)).timestamp())
    return start_ts, end_ts


def _created_on_filters(raw_value: str) -> list[str] | None:
    """Build created_at_ts filter clause(s), or None if raw_value is malformed."""
    match = _DATE_RE.match(raw_value)
    if match is None:
        return None
    op = match.group("op") or "="
    try:
        day = date.fromisoformat(match.group("date"))
    except ValueError:
        return None
    start_ts, end_ts = _day_bounds_ts(day)

    if op == ">":
        return [f"created_at_ts >= {end_ts}"]
    if op == ">=":
        return [f"created_at_ts >= {start_ts}"]
    if op == "<":
        return [f"created_at_ts < {start_ts}"]
    if op == "<=":
        return [f"created_at_ts < {end_ts}"]
    # op == "="
    return [f"created_at_ts >= {start_ts}", f"created_at_ts < {end_ts}"]


def parse_search_query(raw: str) -> ParsedQuery:
    """Parse a search-bar string into Meilisearch filters + free text.

    Supports `tag: <value>`, `createdOn: [op]<YYYY-MM-DD>` (op in >,>=,<,<=,=),
    and `title: <value>` tokens, combinable with free-text fuzzy search.
    A malformed createdOn date is left as literal text rather than raising,
    so a typo mid-keystroke degrades to "no matches" instead of crashing the
    debounced search handler.
    """
    filters: list[str] = []
    attributes_to_search_on: list[str] | None = None
    title_values: list[str] = []
    remaining = raw

    def _replace(match: re.Match[str]) -> str:
        nonlocal attributes_to_search_on
        key = match.group("key")
        value = (
            match.group("qval")
            if match.group("qval") is not None
            else match.group("val")
        )
        if value == "":
            # Empty value after colon (e.g. "tag:") isn't a real token.
            return match.group(0)

        if key == "tag":
            filters.append(f'tags = "{_escape_filter_value(value)}"')
            return ""
        if key == "createdOn":
            clauses = _created_on_filters(value)
            if clauses is None:
                # Malformed date: keep the original text as a literal search term.
                return match.group(0)
            filters.extend(clauses)
            return ""
        if key == "title":
            attributes_to_search_on = ["title"]
            title_values.append(value)
            return ""
        return match.group(0)

    remaining = _FILTER_TOKEN_RE.sub(_replace, remaining)
    text_parts = [*title_values, remaining]
    text = " ".join(part.strip() for part in text_parts if part.strip())
    text = re.sub(r"\s+", " ", text).strip()

    return ParsedQuery(
        text=text, filters=filters, attributes_to_search_on=attributes_to_search_on
    )


# --------------------------------------------------------------------------
# Meilisearch process management
# --------------------------------------------------------------------------


class MeiliBinaryNotFoundError(RuntimeError):
    pass


class MeiliProcessError(RuntimeError):
    pass


@dataclass
class MeiliServerHandle:
    process: subprocess.Popen
    url: str
    master_key: str


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _load_or_create_master_key(key_path: Path) -> str:
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        return key_path.read_text().strip()
    key = secrets.token_hex(32)
    fd = os.open(key_path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(key)
    key_path.chmod(0o600)
    return key


class MeiliProcessManager:
    """Spawns and owns a local `meilisearch` server subprocess."""

    def __init__(
        self,
        data_dir: Path = DEFAULT_MEILI_DATA_DIR,
        log_path: Path = DEFAULT_MEILI_LOG_PATH,
        key_path: Path = DEFAULT_MEILI_KEY_PATH,
        binary_name: str = "meilisearch",
    ) -> None:
        self._data_dir = data_dir
        self._log_path = log_path
        self._key_path = key_path
        self._binary_name = binary_name
        self._process: subprocess.Popen | None = None
        self._log_fh = None

    def start(self, timeout: float = 10.0) -> MeiliServerHandle:
        binary = shutil.which(self._binary_name)
        if binary is None:
            raise MeiliBinaryNotFoundError(
                f"'{self._binary_name}' binary not found on PATH. Install it "
                "(e.g. 'brew install meilisearch' on macOS), then relaunch Composition."
            )

        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        master_key = _load_or_create_master_key(self._key_path)
        port = _free_port()
        url = f"http://127.0.0.1:{port}"

        self._log_fh = open(self._log_path, "a")  # noqa: SIM115 - kept open for process lifetime
        self._process = subprocess.Popen(
            [
                binary,
                "--db-path",
                str(self._data_dir),
                "--http-addr",
                f"127.0.0.1:{port}",
                "--master-key",
                master_key,
                "--no-analytics",
            ],
            stdout=self._log_fh,
            stderr=subprocess.STDOUT,
        )

        self._wait_healthy(url, master_key, timeout)
        return MeiliServerHandle(process=self._process, url=url, master_key=master_key)

    def _wait_healthy(self, url: str, master_key: str, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        client = meilisearch.Client(url, api_key=master_key)
        while time.monotonic() < deadline:
            if self._process is not None and self._process.poll() is not None:
                self._raise_process_died()
            try:
                client.health()
                return
            except MeilisearchCommunicationError:
                time.sleep(0.1)
        self.stop()
        raise MeiliProcessError(
            f"Meilisearch did not become healthy within {timeout}s; "
            f"see log at {self._log_path}"
        )

    def _raise_process_died(self) -> None:
        tail = ""
        try:
            tail = self._log_path.read_text()[-2000:]
        except OSError:
            pass
        self.stop()
        raise MeiliProcessError(f"Meilisearch process exited early. Log tail:\n{tail}")

    def stop(self) -> None:
        if self._process is not None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
            self._process = None
        if self._log_fh is not None:
            self._log_fh.close()
            self._log_fh = None


# --------------------------------------------------------------------------
# Search index wrapper
# --------------------------------------------------------------------------


def _to_ts(iso_str: str) -> int:
    return int(datetime.fromisoformat(iso_str).timestamp())


def _note_to_document(note: Note) -> dict:
    tags = [tag.strip() for tag in note.tags.split(",") if tag.strip()]
    return {
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "tags": tags,
        "created_at_ts": _to_ts(note.created_at),
        "updated_at_ts": _to_ts(note.updated_at),
    }


class SearchIndex:
    """Thin wrapper over a Meilisearch client, scoped to the notes index."""

    def __init__(
        self, url: str, api_key: str, index_uid: str = DEFAULT_INDEX_UID
    ) -> None:
        self._client = meilisearch.Client(url, api_key=api_key)
        self._index_uid = index_uid

    def ensure_index(self) -> None:
        try:
            self._client.get_index(self._index_uid)
        except MeilisearchApiError:
            task = self._client.create_index(self._index_uid, {"primaryKey": "id"})
            self._wait(task.task_uid)

        index = self._client.index(self._index_uid)
        task = index.update_settings(
            {
                "searchableAttributes": ["title", "content"],
                "filterableAttributes": ["tags", "created_at_ts", "updated_at_ts"],
                "sortableAttributes": ["updated_at_ts"],
            }
        )
        self._wait(task.task_uid)

    def index_note(self, note: Note) -> None:
        self._client.index(self._index_uid).add_documents([_note_to_document(note)])

    def delete_note(self, note_id: int) -> None:
        self._client.index(self._index_uid).delete_document(note_id)

    def reindex_all(self, notes: Sequence[Note]) -> None:
        index = self._client.index(self._index_uid)
        task = index.delete_all_documents()
        self._wait(task.task_uid)
        if notes:
            task = index.add_documents([_note_to_document(note) for note in notes])
            self._wait(task.task_uid)

    def search(self, query_str: str) -> list[int]:
        parsed = parse_search_query(query_str)
        opts: dict = {}
        if parsed.filters:
            opts["filter"] = " AND ".join(parsed.filters)
        if parsed.attributes_to_search_on:
            opts["attributesToSearchOn"] = parsed.attributes_to_search_on
        if not parsed.text:
            opts["sort"] = ["updated_at_ts:desc"]
        result = self._client.index(self._index_uid).search(parsed.text, opts)
        return [hit["id"] for hit in result["hits"]]

    def _wait(self, task_uid: int) -> None:
        task = self._client.wait_for_task(task_uid)
        if task.status != "succeeded":
            raise MeiliProcessError(f"Meilisearch task failed: {task.error}")
