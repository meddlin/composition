"""Generates a test dataset of notes for exercising fuzzy search.

Not part of the pytest suite; used by scripts/search_playground.py.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

LOREM_WORDS = [
    "lorem",
    "ipsum",
    "dolor",
    "sit",
    "amet",
    "consectetur",
    "adipiscing",
    "elit",
    "sed",
    "do",
    "eiusmod",
    "tempor",
    "incididunt",
    "ut",
    "labore",
    "et",
    "dolore",
    "magna",
    "aliqua",
    "enim",
    "ad",
    "minim",
    "veniam",
    "quis",
    "nostrud",
    "exercitation",
    "ullamco",
    "laboris",
    "nisi",
    "aliquip",
    "ex",
    "ea",
    "commodo",
    "consequat",
    "duis",
    "aute",
    "irure",
    "in",
    "reprehenderit",
    "voluptate",
    "velit",
    "esse",
    "cillum",
    "eu",
    "fugiat",
    "nulla",
    "pariatur",
    "excepteur",
    "sint",
    "occaecat",
    "cupidatat",
    "non",
    "proident",
    "sunt",
    "culpa",
    "qui",
    "officia",
    "deserunt",
    "mollit",
    "anim",
    "id",
    "est",
    "laborum",
]

TECH_SNIPPETS = [
    (
        "Kubernetes schedules containers across a cluster of nodes using a "
        "declarative model: you describe the desired state and the control "
        "plane continuously reconciles reality toward it. Pods are the "
        "smallest deployable unit, and controllers like Deployments manage "
        "rolling updates and self-healing."
    ),
    (
        "TCP establishes a reliable, ordered byte stream over an unreliable "
        "network using a three-way handshake (SYN, SYN-ACK, ACK). Congestion "
        "control algorithms like TCP Reno and CUBIC adjust the sending rate "
        "based on observed packet loss and round-trip time."
    ),
    (
        "React's reconciliation algorithm diffs the new virtual DOM tree "
        "against the previous one, computing a minimal set of mutations to "
        "apply to the real DOM. Keys help React match list items across "
        "renders so it can reuse existing DOM nodes instead of recreating them."
    ),
    (
        "Relational databases enforce ACID guarantees: atomicity, consistency, "
        "isolation, and durability. Isolation levels like read committed and "
        "serializable trade off concurrency for protection against anomalies "
        "such as dirty reads, non-repeatable reads, and phantom reads."
    ),
    (
        "Git represents history as a directed acyclic graph of commits, each "
        "pointing to a snapshot of the tree and its parent commit(s). "
        "Rebasing rewrites commit history by replaying commits onto a new "
        "base, while merging preserves history by creating a new merge commit."
    ),
    (
        "gRPC uses HTTP/2 as its transport, enabling multiplexed streams over "
        "a single connection, and Protocol Buffers for efficient binary "
        "serialization. Unlike REST, it supports bidirectional streaming RPCs "
        "natively, which suits real-time or high-throughput service meshes."
    ),
    (
        "Python's asyncio event loop runs coroutines cooperatively on a single "
        "thread, switching between tasks at await points rather than using "
        "preemptive OS-level scheduling. This avoids the overhead of thread "
        "context switches but requires all I/O in the call chain to be async."
    ),
    (
        "DNS resolution walks a hierarchy from root servers to TLD servers to "
        "authoritative nameservers, with resolvers caching responses according "
        "to each record's TTL. Anycast routing lets many physical DNS servers "
        "share one IP address, with the network routing queries to the nearest."
    ),
    (
        "WebAssembly is a low-level, sandboxed binary instruction format "
        "designed as a portable compilation target, letting languages like "
        "Rust and C++ run in browsers near-natively. Its linear memory model "
        "and lack of garbage collection keep the runtime predictable and fast."
    ),
    (
        "SQLite implements a full SQL engine as an embedded, serverless "
        "library backed by a single file on disk, using B-tree structures for "
        "tables and indexes and write-ahead logging (WAL) mode to allow "
        "concurrent readers alongside a single writer without blocking."
    ),
]

TITLE_TEMPLATES = [
    "Notes on {topic}",
    "{topic} deep dive",
    "Understanding {topic}",
    "{topic} cheat sheet",
    "Thoughts on {topic}",
    "{topic} roadmap",
    "Intro to {topic}",
    "{topic} troubleshooting log",
]

TOPICS = [
    "Kubernetes",
    "TCP/IP",
    "React",
    "PostgreSQL",
    "Git",
    "gRPC",
    "asyncio",
    "DNS",
    "WebAssembly",
    "SQLite",
    "Docker",
    "Terraform",
    "GraphQL",
    "Redis",
    "Next.js",
    "Rust",
    "load balancing",
    "observability",
    "CI/CD pipelines",
    "event sourcing",
]

TAGS_POOL = ["software", "infra", "networking", "database", "frontend", "backend"]


@dataclass
class DummyNote:
    title: str
    content: str
    tags: str
    created_at: str


def _lorem_paragraph(rng: random.Random, sentence_count: int = 3) -> str:
    sentences = []
    for _ in range(sentence_count):
        length = rng.randint(6, 14)
        words = rng.choices(LOREM_WORDS, k=length)
        words[0] = words[0].capitalize()
        sentences.append(" ".join(words) + ".")
    return " ".join(sentences)


def generate_notes(count: int = 100, seed: int | None = 42) -> list[DummyNote]:
    rng = random.Random(seed)
    notes: list[DummyNote] = []
    now = datetime.now(UTC)

    for _ in range(count):
        topic = rng.choice(TOPICS)
        title = rng.choice(TITLE_TEMPLATES).format(topic=topic)
        content = f"{rng.choice(TECH_SNIPPETS)}\n\n{_lorem_paragraph(rng)}"
        tags = ",".join(rng.sample(TAGS_POOL, k=rng.randint(0, 2)))
        created_at = (now - timedelta(days=rng.randint(0, 400))).isoformat()
        notes.append(
            DummyNote(title=title, content=content, tags=tags, created_at=created_at)
        )

    return notes
