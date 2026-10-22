"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { favoriteLabel } from "./NoteMenu";
import type { Notebook } from "./types";

type Props = {
  groupName: string;
  /** Delete is only offered for a group with no sub-groups or notes. */
  canDelete: boolean;
  favorite: boolean;
  /** The notebooks the group could move to (not the one it is in), chosen in a dialog opened by "Move to a notebook". */
  notebooks: Notebook[];
  onMoveToNotebook: (notebookId: number) => void;
  onRename: () => void;
  onCreateSubgroup: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
};

/**
 * The "⋯" button on a group row and the menu it opens. The menu renders in a
 * portal, so the sidebar's scroll container can't clip it.
 */
export function GroupMenu({
  groupName,
  canDelete,
  favorite,
  notebooks,
  onMoveToNotebook,
  onRename,
  onCreateSubgroup,
  onToggleFavorite,
  onDelete,
}: Props) {
  // Radix hands focus back to the trigger when the menu closes. That's right for
  // Escape, but after choosing an item the action may focus something new (the
  // rename and sub-group fields), and stealing focus would blur and cancel it.
  const chose = useRef(false);
  const [picking, setPicking] = useState(false);

  function choose(action: () => void) {
    chose.current = true;
    action();
  }

  return (
    // Not modal: like the menu this replaced, an outside click closes it and goes through, and the
    // sidebar stays scrollable. A modal menu also traps focus, which would pull the rename and
    // sub-group fields' focus back into the menu while it closes.
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label={`Actions for ${groupName}`}
            title="More actions"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          loop
          aria-label={`${groupName} actions`}
          // No exit animation: while it plays the closed menu is still mounted, and the first pointer
          // move over one of its items hands focus back to it, blurring the new sub-group or rename
          // field, which then cancels itself.
          // No exit animation: while it plays the closed menu is still mounted, and the first pointer
          // move over one of its items hands focus back to it, blurring the new sub-group or rename
          // field, which then cancels itself.
          className="w-48 data-closed:animate-none!"
          // React events bubble through the portal to the row, which renames on double-click.
          onDoubleClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            if (!chose.current) return;
            chose.current = false;
            e.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={() => choose(onRename)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose(onCreateSubgroup)}>
            New sub-group
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleFavorite}>
            {favoriteLabel(favorite)}
          </DropdownMenuItem>
          {notebooks.length > 0 && (
            <DropdownMenuItem onSelect={() => choose(() => setPicking(true))}>
              Move to a notebook
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            title={canDelete ? undefined : "Empty this group before deleting"}
            onSelect={() => choose(onDelete)}
          >
            Delete group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={picking} onOpenChange={setPicking}>
        {/* React events bubble through the portal to the row, which renames on double-click. */}
        <DialogContent
          className="max-w-sm"
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Move to a notebook</DialogTitle>
            <DialogDescription>
              Choose where “{groupName}” goes, with everything inside it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {notebooks.map((notebook) => (
              <Button
                key={notebook.id}
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  setPicking(false);
                  onMoveToNotebook(notebook.id);
                }}
              >
                <span className="truncate">{notebook.name}</span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
