"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The wording of the pin action, shared with the group menu. */
export function favoriteLabel(favorite: boolean): string {
  return favorite ? "Remove from favorites" : "Add to favorites";
}

type Props = {
  /** What the menu is for, e.g. a note's title; names the trigger for assistive tech. */
  label: string;
  favorite: boolean;
  onToggleFavorite: () => void;
};

/**
 * The "⋯" button on a note row (or a row in the Favorites section) and the menu
 * it opens. Its only action so far is pinning; the portaled popup can't be
 * clipped by the sidebar's scroll container.
 */
export function FavoriteMenu({ label, favorite, onToggleFavorite }: Props) {
  return (
    // Not modal, like GroupMenu: an outside click closes it and goes through.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${label}`} title="More actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" loop aria-label={`${label} actions`} className="w-48">
        <DropdownMenuItem onSelect={onToggleFavorite}>{favoriteLabel(favorite)}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
