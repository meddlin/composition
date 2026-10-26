"use client";

import { Fragment, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { BookOpenIcon, ClockIcon, FileTextIcon, FolderIcon, PinIcon } from "lucide-react";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { isFavorite, type Favorites, type FavoriteType } from "@/lib/composition/favorites";
import {
  DEFAULT_HEADER_TITLE,
  HOME_COLORS,
  isNotebookPinned,
  type HomeColor,
  type HomeDensity,
  type HomeSettings,
} from "@/lib/composition/home";
import { buildGroupListing } from "./groupListing";
import { noteExcerpt, pinnedItems, recentNotes, relativeTime, type PinnedItem } from "./homeListing";
import { parseOpened, readOpenedRaw } from "./openedNotes";
import { noteTitle, type Group, type Note, type Notebook } from "./types";

type Props = {
  notebooks: Notebook[];
  groups: Group[];
  notes: Note[];
  favorites: Favorites;
  settings: HomeSettings;
  onToggleFavorite: (type: FavoriteType, id: number) => void;
  onToggleNotebookPin: (id: number) => void;
  onSelectNotebook: (id: number) => void;
  onSelectGroup: (id: number) => void;
  onSelectNote: (id: number) => void;
};

// Class names are written out in full so Tailwind finds them.
const ACCENTS: Record<HomeColor, string> = {
  brand: "bg-brand",
  highlight: "bg-highlight",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
};

/** The notebook's chosen color, or else one of the scheme's colors by its place in the list, so notebooks are told apart at a glance. */
function notebookAccent(settings: HomeSettings, notebooks: Notebook[], notebookId: number): string {
  const chosen = settings.notebookColors[String(notebookId)];
  const index = Math.max(0, notebooks.findIndex((n) => n.id === notebookId));
  return ACCENTS[chosen ?? HOME_COLORS[index % HOME_COLORS.length]];
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const subscribeToNothing = () => () => {};

/**
 * Landing overview: pinned items, every notebook, and the notes touched most recently across all of them.
 * Which sections show, in what order, how the note cards look and what the heading says all come from the
 * user's settings.
 */
export function HomePage({
  notebooks,
  groups,
  notes,
  favorites,
  settings,
  onToggleFavorite,
  onToggleNotebookPin,
  onSelectNotebook,
  onSelectGroup,
  onSelectNote,
}: Props) {
  const { density, header } = settings;
  // The server render can't know what this browser remembers, so it lists as if nothing was opened.
  const openedRaw = useSyncExternalStore(subscribeToNothing, readOpenedRaw, () => "");
  const opened = useMemo(() => parseOpened(openedRaw), [openedRaw]);
  const recentNotebook = notebooks.some((n) => n.id === settings.recentNotebook) ? settings.recentNotebook : null;
  const recent = recentNotes(notes, settings.recentCount, {
    sort: settings.recentSort,
    opened,
    notebookId: recentNotebook,
  });
  const pinned = pinnedItems(notebooks, groups, notes, favorites, settings.pinnedNotebooks);
  const shown = settings.sections.filter((s) => s.visible).map((s) => s.id);
  // The rail is a column of its own, so it needs the rail layout and the notebooks to be shown.
  const rail = settings.layout === "rail" && shown.includes("notebooks");
  const accent = (notebookId: number) => notebookAccent(settings, notebooks, notebookId);
  const notebookName = (notebookId: number) => notebooks.find((n) => n.id === notebookId)?.name;

  const noteCard = (note: Note, isPinned: boolean) => (
    <ItemCard
      key={`note:${note.id}`}
      density={density}
      icon={<FileTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      title={noteTitle(note)}
      excerpt={noteExcerpt(note.content)}
      where={{ color: accent(note.notebookId), label: notebookName(note.notebookId) }}
      detail={relativeTime(note.updatedAt)}
      pinned={isPinned}
      onSelect={() => onSelectNote(note.id)}
      onTogglePin={() => onToggleFavorite("note", note.id)}
    />
  );

  const pinnedCard = (item: PinnedItem) => {
    if (item.kind === "note") return noteCard(item.note, true);
    if (item.kind === "group") {
      const { group } = item;
      return (
        <ItemCard
          key={`group:${group.id}`}
          density={density}
          icon={<FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          title={group.name}
          pinTarget={`group ${group.name}`}
          where={{ color: accent(group.notebookId), label: notebookName(group.notebookId) }}
          detail={countLabel(buildGroupListing(group.id, groups, notes)?.totalNotes ?? 0, "note")}
          pinned
          onSelect={() => onSelectGroup(group.id)}
          onTogglePin={() => onToggleFavorite("group", group.id)}
        />
      );
    }
    const { notebook } = item;
    return (
      <ItemCard
        key={`notebook:${notebook.id}`}
        density={density}
        icon={<BookOpenIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        title={notebook.name}
        pinTarget={`notebook ${notebook.name}`}
        where={{ color: accent(notebook.id), label: "Notebook" }}
        detail={countLabel(notes.filter((n) => n.notebookId === notebook.id).length, "note")}
        pinned
        onSelect={() => onSelectNotebook(notebook.id)}
        onTogglePin={() => onToggleNotebookPin(notebook.id)}
      />
    );
  };

  const pinnedSection = pinned.length > 0 && (
    <section aria-labelledby="home-pinned">
      <SectionTitle id="home-pinned" icon={<PinIcon className="size-4" />}>
        Pinned
      </SectionTitle>
      <ul className={listClass(density)}>{pinned.map(pinnedCard)}</ul>
    </section>
  );

  const notebookSection = (
    <section aria-labelledby="home-notebooks" className={cn(rail && "@3xl:sticky @3xl:top-0")}>
      <SectionTitle id="home-notebooks" icon={<BookOpenIcon className="size-4" />}>
        Notebooks
      </SectionTitle>
      <ul className={cn("mt-4", rail ? "grid grid-cols-1 gap-1 @xl:grid-cols-2 @3xl:grid-cols-1" : "flex flex-wrap gap-2")}>
        {notebooks.map((notebook) => {
          const count = notes.filter((n) => n.notebookId === notebook.id).length;
          const isPinned = isNotebookPinned(settings, notebook.id);
          return (
            <li key={notebook.id} className={cn("group/notebook relative", rail && "min-w-0")}>
              <button
                type="button"
                onClick={() => onSelectNotebook(notebook.id)}
                className={cn(
                  "flex items-center gap-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  rail
                    ? "w-full rounded-lg py-2 pl-3 pr-9 hover:bg-muted"
                    : "rounded-full bg-card py-1.5 pl-3.5 pr-8 ring-1 ring-foreground/10 hover:ring-foreground/25",
                )}
              >
                <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", accent(notebook.id))} />
                <span className="min-w-0 flex-1 truncate font-medium">{notebook.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
              </button>
              <PinButton
                label={`${isPinned ? "Unpin" : "Pin"} notebook ${notebook.name}`}
                pinned={isPinned}
                onClick={() => onToggleNotebookPin(notebook.id)}
                className={cn("top-1/2 -translate-y-1/2", rail ? "right-2" : "right-1.5")}
                hoverGroup="notebook"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );

  const recentSection = (
    <section aria-labelledby="home-recent">
      <SectionTitle id="home-recent" icon={<ClockIcon className="size-4" />}>
        {settings.recentSort === "opened" ? "Recently opened" : "Recently updated"}
      </SectionTitle>
      {recent.length === 0 ? (
        <Empty className="mt-4 border">
          <EmptyDescription>No notes yet.</EmptyDescription>
        </Empty>
      ) : (
        <ul className={listClass(density)}>{recent.map((note) => noteCard(note, isFavorite(favorites, "note", note.id)))}</ul>
      )}
    </section>
  );

  const sections = { notebooks: notebookSection, pinned: pinnedSection, recent: recentSection };
  // In the rail the notebooks leave the flow; whatever else is shown keeps the chosen order.
  const flow = shown.filter((id) => !(rail && id === "notebooks") && sections[id]);
  const content = flow.map((id) => <Fragment key={id}>{sections[id]}</Fragment>);

  return (
    <main aria-label="Home" className="@container min-w-0 flex-1 overflow-y-auto">
      {header.show && (
        <div className="border-b bg-gradient-to-b from-brand/10 to-transparent px-8 pb-8 pt-10">
          <div className={cn("mx-auto", rail ? "max-w-6xl" : "max-w-4xl")}>
            <h1 className="text-3xl font-bold tracking-tight">{header.title || DEFAULT_HEADER_TITLE}</h1>
            <p className="mt-1 text-muted-foreground">
              {countLabel(notes.length, "note")} across {countLabel(notebooks.length, "notebook")}
            </p>
          </div>
        </div>
      )}

      {rail ? (
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-8 py-8 @3xl:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="@3xl:order-2">{notebookSection}</div>
          <div className="flex flex-col gap-10 @3xl:order-1">{content}</div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-4xl flex-col gap-10 px-8 py-8">
          {content}
          {flow.length === 0 && (
            <Empty className="border">
              <EmptyDescription>
                Nothing to show here yet. Pin a note, or choose which sections appear in Settings &gt; Home page.
              </EmptyDescription>
            </Empty>
          )}
        </div>
      )}
    </main>
  );
}

/** The grid or list that holds a section's cards. */
function listClass(density: HomeDensity): string {
  switch (density) {
    case "list":
      return "mt-4 divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10";
    case "compact":
      return "mt-4 grid grid-cols-1 gap-3 @2xl:grid-cols-2";
    case "standard":
      return "mt-4 grid grid-cols-1 gap-4 @2xl:grid-cols-2";
  }
}

type PinButtonProps = {
  label: string;
  pinned: boolean;
  onClick: () => void;
  className: string;
  /** The `group/<name>` ancestor whose hover reveals the button while it is not pinned. */
  hoverGroup: "card" | "notebook";
};

function PinButton({ label, pinned, onClick, className, hoverGroup }: PinButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      onClick={onClick}
      className={cn(
        "absolute flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
        pinned
          ? "text-brand"
          : hoverGroup === "card"
            ? "opacity-0 group-hover/card:opacity-100"
            : "opacity-0 group-hover/notebook:opacity-100",
      )}
    >
      <PinIcon aria-hidden className={cn("size-3.5", pinned && "fill-current")} />
    </button>
  );
}

type ItemCardProps = {
  density: HomeDensity;
  icon: ReactNode;
  title: string;
  /** What the pin button names; the title unless that could be mistaken for a note's. */
  pinTarget?: string;
  /** A preview of the text; shown in the standard size only. */
  excerpt?: string;
  /** Where the item lives: a notebook's color and name. */
  where: { color: string; label?: string };
  /** The time it was updated, or how many notes it holds. */
  detail: string;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
};

/** A note, group or notebook as a card, or as a row in the list size. */
function ItemCard({ density, icon, title, pinTarget = title, excerpt, where, detail, pinned, onSelect, onTogglePin }: ItemCardProps) {
  const list = density === "list";
  const preview = density === "standard" ? excerpt : "";
  const place = (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", where.color)} />
      <span className="truncate">{where.label}</span>
    </span>
  );
  return (
    <li className="group/card relative">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          list
            ? "flex items-center gap-3 py-2.5 pl-4 pr-12 transition-colors hover:bg-muted"
            : cn(
                "flex h-full flex-col rounded-xl bg-card ring-1 ring-foreground/10 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-foreground/25",
                density === "compact" ? "gap-1.5 px-3.5 py-3" : "gap-2 p-4",
              ),
        )}
      >
        {list ? (
          <>
            {icon}
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            <span className="hidden min-w-0 max-w-40 shrink-0 items-center text-xs text-muted-foreground @xl:flex">{place}</span>
            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{detail}</span>
          </>
        ) : (
          <>
            <span className="flex items-start gap-2 pr-7">
              <span className="mt-0.5">{icon}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
            </span>
            {preview && <span className="line-clamp-2 text-sm text-muted-foreground">{preview}</span>}
            <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
              {place}
              <span className="shrink-0">{detail}</span>
            </span>
          </>
        )}
      </button>
      <PinButton
        label={`${pinned ? "Unpin" : "Pin"} ${pinTarget}`}
        pinned={pinned}
        onClick={onTogglePin}
        className={list ? "right-4 top-1/2 -translate-y-1/2" : density === "compact" ? "right-2.5 top-2.5" : "right-3 top-3"}
        hoverGroup="card"
      />
    </li>
  );
}

function SectionTitle({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </h2>
  );
}
