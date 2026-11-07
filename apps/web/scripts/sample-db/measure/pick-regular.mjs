// Prints the title of an ordinary note: generated prose of typical size, in a real group of the first notebook
// (REGULAR_UNGROUPED=1: an ungrouped one, whose row is listed even while every group is collapsed).
// usage: node pick-regular.mjs <database-dir>
import Database from "better-sqlite3";
const db = new Database(process.argv[2] + "/composition.db", { readonly: true });
const row = db
  .prepare(
    `SELECT title, LENGTH(content) AS bytes, group_id FROM notes n
     WHERE notebook_id = 1 AND ${process.env.REGULAR_UNGROUPED ? "group_id IS NULL" : "group_id IS NOT NULL"} AND tags LIKE '%lorem%' AND tags NOT LIKE '%edge-case%'
       AND LENGTH(content) BETWEEN 1500 AND 2600 AND title != '' AND LENGTH(title) < 40
       AND (SELECT COUNT(*) FROM notes m WHERE m.title = n.title) = 1
     ORDER BY id LIMIT 1`,
  )
  .get();
if (!row) {
  console.error("no regular note found");
  process.exit(1);
}
console.error(`picked "${row.title}" (${row.bytes} bytes, group ${row.group_id})`);
process.stdout.write(row.title);
