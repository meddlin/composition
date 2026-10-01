import { NotesApp } from "@/components/notes/NotesApp";
import { loadWorkspace } from "@/lib/composition/service";

// Always render at request time: notes come from a local SQLite file that
// Server Actions mutate directly, and better-sqlite3's native addon isn't
// safe to load inside Turbopack's build-time static-generation worker threads.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { notes, groups, layout, favorites } = await loadWorkspace();
  return (
    <NotesApp
      initialNotes={notes}
      initialGroups={groups}
      initialLayout={layout}
      initialFavorites={favorites}
    />
  );
}
