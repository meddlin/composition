import { noteTitle, type Note } from "./types";

type Props = {
  notes: Note[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
};

export function NoteSidebar({
  notes,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  return (
    <nav
      aria-label="Notes"
      className="flex w-64 shrink-0 flex-col border-r border-foreground/10 bg-foreground/[.03]"
    >
      <div className="p-3">
        <button
          type="button"
          onClick={onCreate}
          className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-80"
        >
          + New note
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-2">
        {notes.map((note) => {
          const active = note.id === activeId;
          return (
            <li key={note.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(note.id)}
                aria-current={active ? "true" : undefined}
                className={`w-full truncate rounded-md px-3 py-2 pr-9 text-left text-sm ${
                  active
                    ? "bg-foreground/10 font-medium"
                    : "hover:bg-foreground/5"
                }`}
              >
                {noteTitle(note)}
              </button>
              <button
                type="button"
                onClick={() => onDelete(note.id)}
                aria-label={`Delete ${noteTitle(note)}`}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs opacity-0 hover:bg-foreground/10 focus:opacity-100 group-hover:opacity-60 group-hover:hover:opacity-100"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
