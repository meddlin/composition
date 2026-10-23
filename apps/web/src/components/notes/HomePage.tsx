"use client";

import { BookOpenIcon, ClockIcon, FileTextIcon } from "lucide-react";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { noteExcerpt, recentNotes, relativeTime } from "./homeListing";
import { noteTitle, type Note, type Notebook } from "./types";

type Props = {
  notebooks: Notebook[];
  notes: Note[];
  onSelectNotebook: (id: number) => void;
  onSelectNote: (id: number) => void;
};

// Each notebook gets one of the scheme's colors, in list order, so cards are told apart at a glance.
const ACCENTS = [
  { tile: "bg-brand/15 text-brand", bar: "bg-brand" },
  { tile: "bg-highlight/15 text-highlight", bar: "bg-highlight" },
  { tile: "bg-success/15 text-success", bar: "bg-success" },
  { tile: "bg-warning/15 text-warning", bar: "bg-warning" },
  { tile: "bg-error/15 text-error", bar: "bg-error" },
] as const;

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Landing overview: every notebook, and the notes touched most recently across all of them. */
export function HomePage({ notebooks, notes, onSelectNotebook, onSelectNote }: Props) {
  const recent = recentNotes(notes);
  const notebookIndex = new Map(notebooks.map((n, i) => [n.id, i]));

  return (
    <main aria-label="Home" className="min-w-0 flex-1 overflow-y-auto">
      <div className="border-b bg-gradient-to-b from-brand/10 to-transparent px-8 pb-8 pt-10">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-muted-foreground">
            {countLabel(notes.length, "note")} across {countLabel(notebooks.length, "notebook")}
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-8 py-8">
        <section aria-labelledby="home-notebooks">
          <SectionTitle id="home-notebooks" icon={<BookOpenIcon className="size-4" />}>
            Notebooks
          </SectionTitle>
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notebooks.map((notebook, index) => {
              const accent = ACCENTS[index % ACCENTS.length];
              const count = notes.filter((n) => n.notebookId === notebook.id).length;
              return (
                <li key={notebook.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNotebook(notebook.id)}
                    className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", accent.bar)} />
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", accent.tile)}>
                      <BookOpenIcon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{notebook.name}</span>
                      <span className="block text-xs text-muted-foreground">{countLabel(count, "note")}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="home-recent">
          <SectionTitle id="home-recent" icon={<ClockIcon className="size-4" />}>
            Recently updated
          </SectionTitle>
          {recent.length === 0 ? (
            <Empty className="mt-4 border">
              <EmptyDescription>No notes yet.</EmptyDescription>
            </Empty>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {recent.map((note) => {
                const index = notebookIndex.get(note.notebookId) ?? 0;
                const accent = ACCENTS[index % ACCENTS.length];
                const excerpt = noteExcerpt(note.content);
                return (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => onSelectNote(note.id)}
                      className="flex h-full w-full flex-col gap-2 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-start gap-2">
                        <FileTextIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-semibold">{noteTitle(note)}</span>
                      </span>
                      {excerpt && <span className="line-clamp-2 text-sm text-muted-foreground">{excerpt}</span>}
                      <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", accent.bar)} />
                          <span className="truncate">{notebooks[index]?.name}</span>
                        </span>
                        <span className="shrink-0">{relativeTime(note.updatedAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function SectionTitle({ id, icon, children }: { id: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </h2>
  );
}
