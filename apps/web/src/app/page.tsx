import { NotesApp } from "@/components/notes/NotesApp";
import { listGroups } from "@/lib/composition/groupsRepo";
import { listNotes } from "@/lib/composition/notesRepo";

// Always render at request time: notes come from a local SQLite file that
// Server Actions mutate directly, and better-sqlite3's native addon isn't
// safe to load inside Turbopack's build-time static-generation worker threads.
export const dynamic = "force-dynamic";

export default async function Home() {
  const notes = listNotes();
  const groups = listGroups();
  return <NotesApp initialNotes={notes} initialGroups={groups} />;
}
