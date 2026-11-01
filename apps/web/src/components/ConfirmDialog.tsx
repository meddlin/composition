"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** More to show under the description, for what does not belong in a sentence (a list). */
  children?: ReactNode;
  /** Holds the confirm button back, for a dialog that is still finding out what it is about. */
  confirmDisabled?: boolean;
};

/**
 * Asks before something destructive happens. Cancel holds the initial focus
 * (Radix's alert dialog default), so an Enter or Space pressed by accident
 * backs out rather than going through with it; Escape and an outside click
 * cancel too.
 */
export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel, children, confirmDisabled }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
