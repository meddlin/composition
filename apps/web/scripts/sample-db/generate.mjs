#!/usr/bin/env node
/**
 * Builds a sample `composition.db` full of generated notes, to stress-test the Markdown/MDX editor and the notes
 * browser at a known size.
 *
 *   node scripts/sample-db/generate.mjs --notes 10000 --out ~/composition-stress/10k
 *
 * writes `<out>/composition.db` (the app's real schema) and `<out>/settings.json` (a web-app settings file whose
 * `appDataDir` is `<out>`), so the web app opens it with
 *
 *   COMPOSITION_SETTINGS_PATH=<out>/settings.json pnpm dev
 *
 * and never touches `~/.composition`. The same `--seed` always gives the same database.
 *
 * Options:
 *   --notes N      how many notes (at least 100; the edge-case notes are part of that count)
 *   --out DIR      where to write (created if missing)
 *   --seed N       random seed (default 1)
 *   --layout L     `realistic` (default): several notebooks, nested groups of uneven sizes, some ungrouped notes;
 *                  `flat`: one notebook, no groups, every note ungrouped (the worst case for a long list)
 *   --no-huge      leave out the edge-case notes tagged `huge` (200 KB to 3 MB each, about 15 MB in all), to see the
 *                  cost of the note count alone. Without it every database holds the same edge-case set, whatever its size.
 *   --force        replace an existing composition.db in DIR
 *
 * The schema below is the final shape db.ts migrates to, written out whole so the app opens the file without migrating
 * (and so without a one-off uuid backfill that would skew a measurement). generate.test.ts opens a generated database
 * through the real data layer and fails if the two ever drift apart.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import yaml from "js-yaml";
import {
  camel,
  cap,
  codeDocument,
  edgeCases,
  everydayDocument,
  loremDocument,
  loremSentence,
  makeRng,
  mdxDocument,
  storyDocument,
} from "./content.mjs";

const SCHEMA = `
CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    group_id INTEGER,
    position INTEGER,
    notebook_id INTEGER,
    uuid TEXT
);
CREATE TABLE groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    position INTEGER,
    notebook_id INTEGER,
    uuid TEXT
);
CREATE TABLE notebooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    position INTEGER,
    uuid TEXT
);
`;

// The same triggers and unique indexes ensureUuids() in db.ts adds, so an insert made by the app gets a uuid.
const UUID_DDL = ["notes", "groups", "notebooks"]
  .map(
    (table) => `
CREATE TRIGGER trg_${table}_fill_uuid AFTER INSERT ON ${table} WHEN NEW.uuid IS NULL
BEGIN
  UPDATE ${table} SET uuid = lower(hex(randomblob(16))) WHERE rowid = NEW.rowid;
END;
CREATE UNIQUE INDEX idx_${table}_uuid ON ${table} (uuid);`,
  )
  .join("\n");

/** Dates are anchored, not "now", so the same seed gives the same file on any day. */
const ANCHOR_END = Date.parse("2026-11-06T18:00:00.000Z");
const ANCHOR_START = Date.parse("2024-01-01T09:00:00.000Z");

const NOTEBOOK_NAMES = ["Main", "Work", "Personal", "Research", "Projects", "Journal", "Recipes", "Archive"];
const GROUP_WORDS = ["Projects", "Archive", "Reading", "Ideas", "Drafts", "Reference", "Journal", "Meetings", "Research", "Recipes", "Travel", "Finance", "Health", "Garden", "Code", "Snippets", "Stories", "Tests", "Inbox", "People", "Clients", "Learning", "Planning", "Reviews"];
const TAG_POOL = [...GROUP_WORDS.map((w) => w.toLowerCase()), "todo", "draft", "idea", "important", "wip", "reference", "meeting", "snippet", "story", "lorem", "mdx", "test", "typescript", "python", "sql", "rust", "go", "css", "shell", "q1", "q2", "q3", "q4", "2024", "2025", "2026", "personal", "work", "urgent", "someday", "book", "article", "video", "recipe", "bug", "design", "api", "docs"];

function parseArgs(argv) {
  const args = { notes: undefined, out: undefined, seed: 1, layout: "realistic", force: false, huge: true };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "--notes") args.notes = Number(value());
    else if (flag === "--out") args.out = value();
    else if (flag === "--seed") args.seed = Number(value());
    else if (flag === "--layout") args.layout = value();
    else if (flag === "--force") args.force = true;
    else if (flag === "--no-huge") args.huge = false;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  return args;
}

function frontmatterOf({ title, description, tags, createdAt, updatedAt }) {
  // The exact serialization of frontmatter.ts, so a note looks as if the app had written it.
  const dateOnly = (iso) => iso.slice(0, 10);
  const text = yaml
    .dump({ title, description, tags, createdAt: dateOnly(createdAt), updatedAt: dateOnly(updatedAt) }, { sortKeys: false, noArrayIndent: true })
    .replace(/^(createdAt|updatedAt): '(\d{4}-\d{2}-\d{2})'$/gm, "$1: $2");
  return `---\n${text}---\n`;
}

/** The text of a note's first `# ` heading, which the generators put on their first line. */
function firstHeading(body) {
  const match = /^# (.+)$/m.exec(body.slice(0, 400));
  return match ? match[1].trim() : "";
}

/** A one-line summary for the `description` column: the first prose sentence, without Markdown. */
function describe(body) {
  for (const line of body.split("\n", 60)) {
    const text = line.trim();
    if (text.length < 40 || /^([#>|`<\-*\d]|\[\^|---)/.test(text)) continue;
    return text.replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").slice(0, 140);
  }
  return "";
}

/** Picks an index by weight in O(log n). */
function weightedIndexPicker(weights, r) {
  const cumulative = [];
  let total = 0;
  for (const w of weights) cumulative.push((total += w));
  return () => {
    const roll = r.next() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > roll) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
}

const iso = (ms) => new Date(ms).toISOString();

export function generate({ notes: total, out, seed = 1, layout = "realistic", force = false, huge = true, log = () => {} }) {
  if (!Number.isInteger(total) || total < 100) throw new Error("--notes must be a whole number of at least 100");
  if (!out) throw new Error("--out is required");
  if (layout !== "realistic" && layout !== "flat") throw new Error('--layout must be "realistic" or "flat"');

  const dir = path.resolve(out);
  const dbPath = path.join(dir, "composition.db");
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    if (!force) throw new Error(`${dbPath} already exists (pass --force to replace it)`);
    for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(dbPath + suffix, { force: true });
  }

  const r = makeRng(seed);
  const flat = layout === "flat";

  // ---- Notebooks ---------------------------------------------------------------------------------------------------
  const notebookCount = flat ? 1 : Math.min(NOTEBOOK_NAMES.length, Math.max(2, Math.round(Math.log10(total) * 2) - 3));
  // The first notebook is the one the app opens, so it holds most of the notes: that is the browser's worst case.
  const notebookShare = flat ? [1] : [0.7, ...Array.from({ length: notebookCount - 1 }, () => 0.3 / (notebookCount - 1))];

  // ---- Edge cases (always in the first notebook) -------------------------------------------------------------------
  const edge = edgeCases(r).filter((c) => huge || !c.tags.includes("huge"));
  if (edge.length > total * 0.5) throw new Error("--notes is too small to hold the edge-case notes");

  // ---- Groups ------------------------------------------------------------------------------------------------------
  /** @type {{id:number,name:string,parentId:number|null,notebookId:number,depth:number,position:number|null,createdAt:string,count:number,handPlaced:boolean}[]} */
  const groups = [];
  const groupsByNotebook = notebookShare.map(() => []);
  const addGroup = (name, notebookId, parentId, depth) => {
    const group = { id: groups.length + 1, name, parentId, notebookId, depth, position: null, createdAt: "", count: 0, handPlaced: r.chance(0.05) };
    groups.push(group);
    groupsByNotebook[notebookId - 1].push(group);
    return group;
  };
  const edgeGroup = flat ? null : addGroup("00 Edge cases", 1, null, 0);
  if (!flat) {
    notebookShare.forEach((share, index) => {
      const notebookId = index + 1;
      const notesHere = Math.round((total - edge.length) * share);
      const wanted = Math.max(3, Math.round(notesHere / 40));
      const topLevel = Math.max(2, Math.round(wanted * 0.12));
      for (let g = 0; g < wanted; g++) {
        const pool = groupsByNotebook[index].filter((x) => x !== edgeGroup);
        const makeTop = pool.length < topLevel;
        // Nest under an existing group (up to four levels deep), favoring recent ones so some branches go deep.
        const parent = makeTop ? null : pool.filter((x) => x.depth < 3)[Math.floor(r.next() ** 1.6 * pool.filter((x) => x.depth < 3).length)] ?? null;
        const suffix = r.chance(0.25) ? ` ${r.pick(["2024", "2025", "2026", "A", "B", "Old", "New", String(r.int(1, 30))])}` : "";
        addGroup(`${r.pick(GROUP_WORDS)} ${cap(camel(r, 1))}${suffix}`, notebookId, parent ? parent.id : null, parent ? parent.depth + 1 : 0);
      }
    });
  }
  // Group sizes are heavy-tailed: a few groups hold hundreds or thousands of notes, most hold a handful.
  const eligible = (notebookId) => groupsByNotebook[notebookId - 1].filter((g) => g !== edgeGroup);
  const pickers = notebookShare.map((_, i) => {
    const list = eligible(i + 1);
    const order = r.shuffle(list.map((_, k) => k));
    return list.length ? { list, pick: weightedIndexPicker(order.map((rank) => 1 / (rank + 1) ** 0.95), r) } : null;
  });

  // ---- Notes -------------------------------------------------------------------------------------------------------
  const plans = [];
  for (let i = 0; i < edge.length; i++) {
    plans.push({ kind: "edge", notebookId: 1, groupId: edgeGroup ? edgeGroup.id : null, edge: edge[i] });
  }
  const ungroupedShare = flat ? 1 : 0.06;
  for (let i = edge.length; i < total; i++) {
    let notebookId = 1;
    if (!flat) {
      let roll = r.next();
      notebookId = 0;
      while (notebookId < notebookShare.length - 1 && (roll -= notebookShare[notebookId]) >= 0) notebookId++;
      notebookId += 1;
    }
    const picker = pickers[notebookId - 1];
    const groupId = !picker || r.chance(ungroupedShare) ? null : picker.list[picker.pick()].id;
    plans.push({ kind: r.weighted([["lorem", 28], ["code", 26], ["story", 20], ["mdx", 14], ["everyday", 12]]), notebookId, groupId });
  }
  // Shuffle so ids interleave kinds, notebooks and groups the way a real database grows.
  const order = r.shuffle(plans);

  // Timestamps rise with id, like a real database (the app's default order leans on `updated_at DESC, id DESC`).
  const span = ANCHOR_END - ANCHOR_START;
  const createdAtOf = (index) => ANCHOR_START + Math.floor((index / order.length) * span) + r.int(0, 3_600_000);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");
  db.exec(SCHEMA);
  db.exec(UUID_DDL);

  const insertNotebook = db.prepare("INSERT INTO notebooks (id, name, created_at, updated_at, position, uuid) VALUES (?, ?, ?, ?, NULL, ?)");
  const insertGroup = db.prepare("INSERT INTO groups (id, name, parent_id, created_at, updated_at, position, notebook_id, uuid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertNote = db.prepare(
    `INSERT INTO notes (id, title, content, created_at, updated_at, tags, description, group_id, position, notebook_id, uuid)
     VALUES (@id, @title, @content, @createdAt, @updatedAt, @tags, @description, @groupId, @position, @notebookId, @uuid)`,
  );

  const stats = { bytes: 0, maxBytes: 0, byKind: {}, titles: [], sizes: [] };
  const seenUuids = new Set();
  const uuid = () => {
    for (;;) {
      const value = r.hex(32);
      if (!seenUuids.has(value)) {
        seenUuids.add(value);
        return value;
      }
    }
  };
  const nextPosition = new Map();

  db.transaction(() => {
    notebookShare.forEach((_, index) => {
      const at = iso(ANCHOR_START - 86_400_000 * (index + 1));
      insertNotebook.run(index + 1, NOTEBOOK_NAMES[index], at, at, uuid());
    });
    groups.forEach((group, index) => {
      group.createdAt = iso(ANCHOR_START + Math.floor((index / Math.max(1, groups.length)) * span * 0.5));
      insertGroup.run(group.id, group.name, group.parentId, group.createdAt, group.createdAt, null, group.notebookId, uuid());
    });

    order.forEach((plan, index) => {
      const id = index + 1;
      const links = Array.from({ length: 6 }, () => r.int(1, total));
      const target = Math.round(Math.min(120_000, Math.max(150, r.lognormal(1800, 1.0))));
      let title;
      let body;
      let tags;
      if (plan.kind === "edge") {
        title = plan.edge.title;
        body = plan.edge.body;
        tags = plan.edge.tags;
      } else {
        body = {
          lorem: () => loremDocument(r, target),
          code: () => codeDocument(r, target),
          story: () => storyDocument(r, target),
          mdx: () => mdxDocument(r, target, { youtube: r.chance(0.04), links }),
          everyday: () => everydayDocument(r, target, links),
        }[plan.kind]();
        title = firstHeading(body) || cap(loremSentence(r, 4).slice(0, -1));
        tags = [...new Set(Array.from({ length: r.weighted([[0, 2], [1, 3], [2, 4], [3, 3], [4, 1], [5, 0.3]]) }, () => r.pick(TAG_POOL)))];
        tags.push(plan.kind);
        tags = [...new Set(tags)];
      }
      const createdMs = createdAtOf(index);
      const updatedMs = Math.min(ANCHOR_END, createdMs + Math.floor(-Math.log(1 - r.next()) * 20 * 86_400_000));
      const createdAt = iso(createdMs);
      const updatedAt = iso(updatedMs);
      const description = plan.kind === "edge" || r.chance(0.4) ? "" : describe(body);

      const group = plan.groupId === null ? null : groups[plan.groupId - 1];
      let position = null;
      if (group?.handPlaced) {
        position = nextPosition.get(group.id) ?? 0;
        nextPosition.set(group.id, position + 1);
      }
      if (group) group.count++;

      const content = frontmatterOf({ title, description, tags, createdAt, updatedAt }) + body;
      insertNote.run({
        id,
        title,
        content,
        createdAt,
        updatedAt,
        tags: tags.join(","),
        description,
        groupId: plan.groupId,
        position,
        notebookId: plan.notebookId,
        uuid: uuid(),
      });

      const bytes = Buffer.byteLength(content);
      stats.bytes += bytes;
      stats.maxBytes = Math.max(stats.maxBytes, bytes);
      stats.sizes.push(bytes);
      stats.byKind[plan.kind] = (stats.byKind[plan.kind] ?? 0) + 1;
      if (index % 5000 === 4999) log(`  ${index + 1} / ${order.length} notes`);
    });
  })();

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });

  fs.writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify({ appDataDir: dir }, null, 2)}\n`);

  stats.sizes.sort((a, b) => a - b);
  const pct = (p) => stats.sizes[Math.min(stats.sizes.length - 1, Math.floor(p * stats.sizes.length))];
  const largestGroup = groups.reduce((best, g) => (g.count > best.count ? g : best), { count: 0, name: "" });
  const manifest = {
    seed,
    layout,
    notes: total,
    notebooks: notebookShare.map((share, i) => ({
      id: i + 1,
      name: NOTEBOOK_NAMES[i],
      notes: order.filter((p) => p.notebookId === i + 1).length,
      groups: groupsByNotebook[i].length,
      ungroupedNotes: order.filter((p) => p.notebookId === i + 1 && p.groupId === null).length,
    })),
    groups: groups.length,
    maxGroupDepth: groups.reduce((m, g) => Math.max(m, g.depth + 1), 0),
    largestGroup: { name: largestGroup.name, notes: largestGroup.count },
    kinds: stats.byKind,
    edgeCases: edge.length,
    contentBytes: { total: stats.bytes, median: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: stats.maxBytes },
    dbBytes: fs.statSync(dbPath).size,
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, dbPath, manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || args.notes === undefined || !args.out) {
      console.log("Usage: node scripts/sample-db/generate.mjs --notes N --out DIR [--seed N] [--layout realistic|flat] [--no-huge] [--force]");
      process.exit(args.help ? 0 : 1);
    }
    const started = Date.now();
    const { dir, manifest } = generate({ ...args, log: (line) => console.log(line) });
    const mb = (n) => `${(n / 1_048_576).toFixed(1)} MB`;
    console.log(
      `Wrote ${manifest.notes} notes in ${manifest.groups} groups across ${manifest.notebooks.length} notebook(s) to ${dir} ` +
        `(${mb(manifest.dbBytes)}, ${((Date.now() - started) / 1000).toFixed(1)} s)\n` +
        `Open it with: COMPOSITION_SETTINGS_PATH=${path.join(dir, "settings.json")} pnpm --dir apps/web dev`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
