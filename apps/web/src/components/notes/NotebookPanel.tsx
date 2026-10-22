"use client";

import { BookOpenIcon, MoreHorizontalIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { InlineTextInput } from "./GroupTree";
import { COLLAPSED_NOTEBOOK_PANEL_WIDTH } from "./notebookPanelPrefs";
import type { Notebook } from "./types";

type Props = {
  collapsed: boolean;
  width: number;
  notebooks: Notebook[];
  /** The open notebook, shown highlighted: the list is what says which one is active. */
  activeId: number;
  /** Ids of notebooks with no groups or notes; only those can be deleted (and never the last one). */
  emptyIds: ReadonlySet<number>;
  onToggleCollapsed: () => void;
  onSelect: (id: number) => void;
  onCreate: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
};

/**
 * The notebook list: a second, narrower sidebar beside the main one. The notebook that is
 * open is highlighted. It collapses to a thin rail holding only the button that reopens it;
 * the width is dragged with the divider the workspace puts after it.
 */
export function NotebookPanel({
  collapsed,
  width,
  notebooks,
  activeId,
  emptyIds,
  onToggleCollapsed,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);

  if (collapsed) {
    return (
      <aside
        aria-label="Notebooks"
        style={{ width: COLLAPSED_NOTEBOOK_PANEL_WIDTH }}
        className="flex shrink-0 flex-col items-center bg-surface py-2"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Show notebooks"
          aria-expanded={false}
          title="Show notebooks"
          onClick={onToggleCollapsed}
        >
          <PanelLeftOpenIcon />
        </Button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Notebooks"
      style={{ width }}
      className="flex shrink-0 flex-col bg-surface"
    >
      <div className="flex items-center justify-between pl-3 pr-2 pt-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notebooks</h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Hide notebooks"
          aria-expanded
          title="Hide notebooks"
          onClick={onToggleCollapsed}
        >
          <PanelLeftCloseIcon />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {notebooks.map((notebook) => (
            <li key={notebook.id}>
              {renamingId === notebook.id ? (
                <InlineTextInput
                  depth={0}
                  initialValue={notebook.name}
                  placeholder="Notebook name"
                  onSubmit={(name) => {
                    if (name !== notebook.name) onRename(notebook.id, name);
                    setRenamingId(null);
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <NotebookRow
                  notebook={notebook}
                  active={notebook.id === activeId}
                  canDelete={notebooks.length > 1 && emptyIds.has(notebook.id)}
                  onSelect={() => onSelect(notebook.id)}
                  onRename={() => setRenamingId(notebook.id)}
                  onDelete={() => onDelete(notebook.id)}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="p-2">
        {creating ? (
          <InlineTextInput
            depth={0}
            placeholder="Notebook name"
            onSubmit={(name) => {
              onCreate(name);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Button variant="outline" size="lg" className="w-full" onClick={() => setCreating(true)}>
            + New notebook
          </Button>
        )}
      </div>
    </aside>
  );
}

function NotebookRow({
  notebook,
  active,
  canDelete,
  onSelect,
  onRename,
  onDelete,
}: {
  notebook: Notebook;
  active: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  // Radix returns focus to the trigger on close, which would blur (and so cancel)
  // the rename field the menu item just opened; see GroupMenu.
  const chose = useRef(false);

  return (
    <div
      className={cn(
        "group/row relative flex items-center rounded-md",
        active ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        onDoubleClick={onRename}
        className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 font-medium hover:bg-transparent dark:hover:bg-transparent"
      >
        <BookOpenIcon className="text-muted-foreground" />
        <span className="truncate">{notebook.name}</span>
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for notebook ${notebook.name}`}
            title="More actions"
            className="mr-1 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          loop
          className="w-44 data-closed:animate-none!"
          onCloseAutoFocus={(e) => {
            if (!chose.current) return;
            chose.current = false;
            e.preventDefault();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              chose.current = true;
              onRename();
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            title={canDelete ? undefined : "Empty this notebook before deleting it"}
            onSelect={onDelete}
          >
            Delete notebook
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
