"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { favoriteLabel } from "./FavoriteMenu";

type Props = {
  groupName: string;
  /** Delete is only offered for a group with no sub-groups or notes. */
  canDelete: boolean;
  favorite: boolean;
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
  onRename,
  onCreateSubgroup,
  onToggleFavorite,
  onDelete,
}: Props) {
  // Radix hands focus back to the trigger when the menu closes. That's right for
  // Escape, but after choosing an item the action may focus something new (the
  // rename and sub-group fields), and stealing focus would blur and cancel it.
  const chose = useRef(false);

  function choose(action: () => void) {
    chose.current = true;
    action();
  }

  return (
    // Not modal: like the menu this replaced, an outside click closes it and goes through, and the
    // sidebar stays scrollable. A modal menu also traps focus, which would pull the rename and
    // sub-group fields' focus back into the menu while it closes.
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
        className="w-48"
        // React events bubble through the portal to the row, which renames on double-click.
        onDoubleClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          if (!chose.current) return;
          chose.current = false;
          e.preventDefault();
        }}
      >
        <DropdownMenuItem onSelect={() => choose(onRename)}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose(onCreateSubgroup)}>New sub-group</DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleFavorite}>{favoriteLabel(favorite)}</DropdownMenuItem>
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
  );
}
