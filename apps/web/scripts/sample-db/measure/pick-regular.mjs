// Prints the title of an ordinary note to open and type in: generated prose of typical size, in a real group of the first
// notebook (REGULAR_UNGROUPED=1: an ungrouped one, whose row is listed even while every group is collapsed).
// A small database may have none that fit, so it falls back to ever looser rules, and only gives up when every note is an
// edge case or a line-count note. usage: node pick-regular.mjs <database-dir>
import Database from "better-sqlite3";

const db = new Database(process.argv[2] + "/composition.db", { readonly: true });
const ungrouped = Boolean(process.env.REGULAR_UNGROUPED);
const placed = ungrouped ? "group_id IS NULL" : "group_id IS NOT NULL";
const ordinary = "tags NOT LIKE '%edge-case%' AND tags NOT LIKE '%line-count%' AND title != ''";
const unique = "(SELECT COUNT(*) FROM notes m WHERE m.title = n.title) = 1";

const attempts = [
  ["an ordinary prose note", `notebook_id = 1 AND ${placed} AND tags LIKE '%lorem%' AND ${ordinary} AND LENGTH(content) BETWEEN 1500 AND 2600 AND LENGTH(title) < 40 AND ${unique}`],
  ["any ordinary note of typical size", `notebook_id = 1 AND ${ordinary} AND LENGTH(content) BETWEEN 300 AND 20000 AND LENGTH(title) < 60 AND ${unique}`],
  ["any ordinary note", `notebook_id = 1 AND ${ordinary} AND LENGTH(title) < 60`],
];

for (const [what, where] of attempts) {
  const row = db.prepare(`SELECT title, LENGTH(content) AS bytes, group_id FROM notes n WHERE ${where} ORDER BY id LIMIT 1`).get();
  if (row) {
    console.error(`picked "${row.title}" (${row.bytes} bytes, group ${row.group_id}): ${what}`);
    process.stdout.write(row.title);
    process.exit(0);
  }
}
console.error("no ordinary note found");
process.exit(1);
