"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * The small "⋯" menu beside Remove on a to-do row or board card. Remove is one click and can be undone; what is here
 * cannot be, so it is a step further away: Delete permanently erases the item, what is under it and their history.
 */
export function TodoMenu({ title, onDeleteForGood }: { title: string; onDeleteForGood: () => void }) {
  return (
    // Not modal, like the notes' menus: an outside click closes it and goes through, and the dialog it opens can take focus.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${title}`} title="More actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" loop aria-label={`${title} actions`}>
        <DropdownMenuItem variant="destructive" onSelect={onDeleteForGood}>
          Delete permanently…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
