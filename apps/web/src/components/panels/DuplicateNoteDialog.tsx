"use client";

import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

type Props = {
  title: string;
  /** `dontWarnAgain` is whether the box was ticked. */
  onOpenAnyway: (dontWarnAgain: boolean) => void;
  onCancel: () => void;
};

/**
 * Asked when a note is about to be shown in a second panel on purpose. Both panels edit one copy of the note, so
 * nothing is lost, but the editor in the other panel may forget its undo history when this one is typed in.
 */
export function DuplicateNoteDialog({ title, onOpenAnyway, onCancel }: Props) {
  const [dontWarnAgain, setDontWarnAgain] = useState(false);

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>“{title}” is already open in another panel</AlertDialogTitle>
          <AlertDialogDescription>
            Both panels show the same note and stay in sync, but the undo history in the other panel may reset when you type here.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center gap-2">
          <Checkbox id="dont-warn-duplicate" checked={dontWarnAgain} onCheckedChange={(checked) => setDontWarnAgain(checked === true)} />
          <Label htmlFor="dont-warn-duplicate">Don&apos;t warn me again</Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onOpenAnyway(dontWarnAgain)}>Open anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
