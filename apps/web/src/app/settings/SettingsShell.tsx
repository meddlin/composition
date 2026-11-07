"use client";

import { MenuIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { revealSetting, searchSettings, type SettingsHit } from "./settingsSearch";

export type SettingsPage = {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
};

type Search = { query: string; hits: SettingsHit[] };
const NO_SEARCH: Search = { query: "", hits: [] };

/** The width (Tailwind's `md`) from which the page list sits beside the settings; below it, it slides over them. */
const SIDEBAR_MEDIA = "(min-width: 48rem)";

type NavProps = {
  pages: SettingsPage[];
  pageId: string;
  search: Search;
  onSearch: (query: string) => void;
  onOpenPage: (id: string) => void;
  onOpenHit: (hit: SettingsHit) => void;
};

/** The search box and, under it, the pages, or what the search found in place of them. */
function SettingsNav({ pages, pageId, search, onSearch, onOpenPage, onOpenHit }: NavProps) {
  const { query, hits } = search;
  const searching = query.trim() !== "";

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && hits[0]) {
      event.preventDefault();
      onOpenHit(hits[0]);
    } else if (event.key === "Escape" && query !== "") {
      onSearch("");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="search" className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={onKeyDown}
          className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
        />
        {query !== "" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search"
            onClick={() => onSearch("")}
            className="absolute top-1/2 right-1 -translate-y-1/2"
          >
            <XIcon />
          </Button>
        )}
      </div>

      <nav aria-label="Settings sections">
        {searching ? (
          <>
            <p role="status" className={cn("px-3 text-sm text-muted-foreground", hits.length > 0 && "sr-only")}>
              {hits.length === 0
                ? `No settings match “${query.trim()}”.`
                : `${hits.length} ${hits.length === 1 ? "setting" : "settings"} found`}
            </p>
            <ul aria-label="Search results" className="flex flex-col gap-0.5">
              {hits.map((hit, index) => (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => onOpenHit(hit)}
                    className="flex w-full flex-col items-start rounded-md px-3 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span>{hit.title}</span>
                    {hit.title !== hit.pageLabel && (
                      <span className="text-xs text-muted-foreground">{hit.pageLabel}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {pages.map((page) => (
              <li key={page.id}>
                <button
                  type="button"
                  aria-current={page.id === pageId ? "page" : undefined}
                  onClick={() => onOpenPage(page.id)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  {page.icon}
                  {page.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

/**
 * The Settings pages with a list of them down the left and a search box above it. When the window is too narrow
 * to give the settings room beside the list, the list slides in from a menu button instead.
 *
 * Every page stays mounted while another is showing, so a half-edited form survives a look at another page and
 * the search can read all of them.
 */
export function SettingsShell({ pages }: { pages: SettingsPage[] }) {
  const [pageId, setPageId] = useState(pages[0].id);
  const [search, setSearch] = useState(NO_SEARCH);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reveal, setReveal] = useState<{ element: HTMLElement }>();
  const shell = useRef<HTMLDivElement>(null);
  const panels = useRef(new Map<string, HTMLElement>());

  // The slideover has no place once the list sits beside the settings: close it as the window grows.
  useEffect(() => {
    const media = window.matchMedia?.(SIDEBAR_MEDIA);
    if (!media) return;
    const closeWhenWide = () => media.matches && setMenuOpen(false);
    media.addEventListener("change", closeWhenWide);
    return () => media.removeEventListener("change", closeWhenWide);
  }, []);

  // After the chosen page has shown, which is why this is not done where it is chosen.
  useEffect(() => {
    if (reveal) revealSetting(reveal.element);
  }, [reveal]);

  function find(query: string) {
    const searchable = pages.flatMap(({ id, label }) => {
      const root = panels.current.get(id);
      return root ? [{ id, label, root }] : [];
    });
    setSearch({ query, hits: searchSettings(searchable, query) });
  }

  function openPage(id: string) {
    setPageId(id);
    setSearch(NO_SEARCH);
    setMenuOpen(false);
    // A long page leaves the next one scrolled down: start it from the top.
    if (shell.current && shell.current.getBoundingClientRect().top < 0) shell.current.scrollIntoView?.();
  }

  function openHit(hit: SettingsHit) {
    setPageId(hit.pageId);
    setSearch(NO_SEARCH);
    setMenuOpen(false);
    setReveal({ element: hit.element });
  }

  const nav = { pages, pageId, search, onSearch: find, onOpenPage: openPage, onOpenHit: openHit };

  return (
    <div ref={shell} className="flex flex-col gap-4 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-8">
      <aside className="sticky top-6 hidden md:block">
        <SettingsNav {...nav} />
      </aside>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <MenuIcon /> Menu
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              // Opening to choose a page shouldn't raise the keyboard; the search box is one tap away.
              onOpenAutoFocus={(event) => event.preventDefault()}
              // In the search box, Escape clears the search; the menu closes on the next one.
              onEscapeKeyDown={(event) => {
                if (search.query !== "" && event.target instanceof Element && event.target.closest('[role="search"]')) {
                  event.preventDefault();
                }
              }}
            >
              <SheetHeader>
                <SheetTitle>Settings</SheetTitle>
                <SheetDescription className="sr-only">Choose a settings page, or search for a setting.</SheetDescription>
              </SheetHeader>
              <SettingsNav {...nav} />
            </SheetContent>
          </Sheet>
        </div>

        {pages.map((page) => (
          <section
            key={page.id}
            ref={(element) => {
              if (element) panels.current.set(page.id, element);
              else panels.current.delete(page.id);
            }}
            hidden={page.id !== pageId}
            aria-labelledby={`settings-${page.id}`}
          >
            <div className="flex flex-col gap-6">
              <h2 id={`settings-${page.id}`} className="text-base font-semibold">
                {page.label}
              </h2>
              {page.content}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
