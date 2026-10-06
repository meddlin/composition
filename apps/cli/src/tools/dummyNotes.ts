/**
 * Dummy notes for exercising search (`pnpm seed`, `pnpm search:playground`).
 *
 * Pure and deterministic for a given seed, so tests (and anyone comparing search
 * results) see the same notes every time. Not for real use.
 */

export type DummyNote = {
  title: string;
  /** The note's text after its frontmatter. */
  body: string;
  /** Comma-joined, the way the database stores tags. */
  tags: string;
  createdAt: string;
};

const LOREM_WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod", "tempor",
  "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis", "nostrud",
  "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex", "ea", "commodo", "consequat", "duis", "aute", "irure",
  "in", "reprehenderit", "voluptate", "velit", "esse", "cillum", "eu", "fugiat", "nulla", "pariatur", "excepteur",
  "sint", "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui", "officia", "deserunt", "mollit", "anim",
  "id", "est", "laborum",
];

const TECH_SNIPPETS = [
  "Kubernetes schedules containers across a cluster of nodes using a declarative model: you describe the desired state and the control plane continuously reconciles reality toward it. Pods are the smallest deployable unit, and controllers like Deployments manage rolling updates and self-healing.",
  "TCP establishes a reliable, ordered byte stream over an unreliable network using a three-way handshake (SYN, SYN-ACK, ACK). Congestion control algorithms like TCP Reno and CUBIC adjust the sending rate based on observed packet loss and round-trip time.",
  "React's reconciliation algorithm diffs the new virtual DOM tree against the previous one, computing a minimal set of mutations to apply to the real DOM. Keys help React match list items across renders so it can reuse existing DOM nodes instead of recreating them.",
  "Relational databases enforce ACID guarantees: atomicity, consistency, isolation, and durability. Isolation levels like read committed and serializable trade off concurrency for protection against anomalies such as dirty reads, non-repeatable reads, and phantom reads.",
  "Git represents history as a directed acyclic graph of commits, each pointing to a snapshot of the tree and its parent commit(s). Rebasing rewrites commit history by replaying commits onto a new base, while merging preserves history by creating a new merge commit.",
  "gRPC uses HTTP/2 as its transport, enabling multiplexed streams over a single connection, and Protocol Buffers for efficient binary serialization. Unlike REST, it supports bidirectional streaming RPCs natively, which suits real-time or high-throughput service meshes.",
  "Node's event loop runs callbacks cooperatively on a single thread, switching between tasks when one awaits rather than using preemptive OS-level scheduling. This avoids the overhead of thread context switches but requires all I/O in the call chain to be asynchronous.",
  "DNS resolution walks a hierarchy from root servers to TLD servers to authoritative nameservers, with resolvers caching responses according to each record's TTL. Anycast routing lets many physical DNS servers share one IP address, with the network routing queries to the nearest.",
  "WebAssembly is a low-level, sandboxed binary instruction format designed as a portable compilation target, letting languages like Rust and C++ run in browsers near-natively. Its linear memory model and lack of garbage collection keep the runtime predictable and fast.",
  "SQLite implements a full SQL engine as an embedded, serverless library backed by a single file on disk, using B-tree structures for tables and indexes and write-ahead logging (WAL) mode to allow concurrent readers alongside a single writer without blocking.",
];

export const TITLE_TEMPLATES = [
  "Notes on {topic}",
  "{topic} deep dive",
  "Understanding {topic}",
  "{topic} cheat sheet",
  "Thoughts on {topic}",
  "{topic} roadmap",
  "Intro to {topic}",
  "{topic} troubleshooting log",
];

export const TOPICS = [
  "Kubernetes", "TCP/IP", "React", "PostgreSQL", "Git", "gRPC", "async/await", "DNS", "WebAssembly", "SQLite",
  "Docker", "Terraform", "GraphQL", "Redis", "Next.js", "Rust", "load balancing", "observability", "CI/CD pipelines",
  "event sourcing",
];

export const TAGS_POOL = ["software", "infra", "networking", "database", "frontend", "backend"];

/** A small seeded random number generator (mulberry32): the same seed gives the same sequence. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function generateNotes(count = 100, seed = 42, now = Date.now()): DummyNote[] {
  const random = randomFrom(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)];
  /** `size` different items, in random order. */
  const sample = <T,>(items: readonly T[], size: number): T[] => {
    const pool = [...items];
    const out: T[] = [];
    for (let i = 0; i < size; i++) out.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    return out;
  };

  const paragraph = (sentences = 3): string =>
    Array.from({ length: sentences }, () => {
      const words = Array.from({ length: int(6, 14) }, () => pick(LOREM_WORDS));
      words[0] = words[0][0].toUpperCase() + words[0].slice(1);
      return `${words.join(" ")}.`;
    }).join(" ");

  return Array.from({ length: count }, (): DummyNote => {
    const topic = pick(TOPICS);
    const title = pick(TITLE_TEMPLATES).replace("{topic}", topic);
    const body = `${pick(TECH_SNIPPETS)}\n\n${paragraph()}\n`;
    const tags = sample(TAGS_POOL, int(0, 2)).join(",");
    const createdAt = new Date(now - int(0, 400) * DAY_MS).toISOString();
    return { title, body, tags, createdAt };
  });
}
