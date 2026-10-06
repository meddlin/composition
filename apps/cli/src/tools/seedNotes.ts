import Database from "better-sqlite3";
import { frontmatter, listNotes, loadWebSettings, resolvedDbPath, searchIndex, service } from "../backend";
import { generateNotes, type DummyNote } from "./dummyNotes";

/**
 * Fills the database the shared settings point at with dummy notes, each with real
 * frontmatter and its creation date spread over the past year and more (so `created:`
 * filters have something to filter). The caller chooses where, by setting
 * COMPOSITION_SETTINGS_PATH to a scratch file first: this never picks a location itself.
 */
export async function seedNotes(notes: readonly DummyNote[] = generateNotes()): Promise<number> {
  await service.loadWorkspace(); // creates the database and its tables if they aren't there yet
  const db = new Database(resolvedDbPath(loadWebSettings()));
  try {
    const insert = db.prepare(
      "INSERT INTO notes (title, content, tags, description, created_at, updated_at, group_id) VALUES (?, ?, ?, '', ?, ?, NULL)",
    );
    const insertAll = db.transaction((rows: readonly DummyNote[]) => {
      for (const note of rows) {
        const content =
          frontmatter.generate(note.title, {
            createdAt: note.createdAt,
            updatedAt: note.createdAt,
            tags: frontmatter.tagsFromString(note.tags),
          }) + note.body;
        insert.run(note.title, content, note.tags, note.createdAt, note.createdAt);
      }
    });
    insertAll(notes);
  } finally {
    db.close();
  }
  return notes.length;
}

/** Rebuilds the search index from what is in the database now. */
export async function indexEverything(): Promise<number> {
  const notes = listNotes();
  await searchIndex.reindexAll(notes);
  return notes.length;
}
