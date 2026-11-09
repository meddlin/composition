"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * What exporting a PDF with its marks asks first: whether to flatten them. Native marks (the default) stay editable and visible
 * in other apps; flattened ones are drawn into the pages, so every app shows the same and none can be edited or removed. Choosing
 * the file is the operating system's own dialog, which opens when Export is pressed.
 */
export function ExportPdfDialog({
  open,
  onOpenChange,
  onExport,
  protectedByPassword = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (flatten: boolean) => void;
  /** The PDF needs a password to open (and was opened with one): the copy is protected with the same password. */
  protectedByPassword?: boolean;
}) {
  const [flatten, setFlatten] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export annotated PDF</DialogTitle>
          <DialogDescription>Saves a copy of this PDF with your highlights, underlines, strikethroughs and text notes in it. The PDF in your library is not changed.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2">
          <Checkbox id="export-flatten" checked={flatten} onCheckedChange={(checked) => setFlatten(checked === true)} className="mt-0.5" />
          <div className="grid gap-1">
            <Label htmlFor="export-flatten">Flatten markup</Label>
            <p className="text-sm text-muted-foreground">
              Draw the marks into the pages, so every app shows them the same. They can no longer be edited or removed. Without this, the marks are annotations that other apps can edit.
            </p>
          </div>
        </div>
        {protectedByPassword && (
          <p className="text-sm text-muted-foreground">This PDF is protected by a password. The copy is protected with the same password, and has the same limits on printing and copying.</p>
        )}
        <p className="text-sm text-muted-foreground">Text notes support Latin, Greek and Cyrillic letters and common math symbols.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onExport(flatten)}>Export…</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
