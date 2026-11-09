"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * What a PDF that is protected by a password asks first: the password. It is handed to the reader (which gives it to pdf.js and
 * keeps it in memory for this session) and is never stored or shown again; the box is emptied as soon as it is sent. A wrong
 * password says so and asks again; Cancel leaves the panel saying the PDF is protected, with a button to ask again.
 */
export function PdfPasswordDialog({
  open,
  onOpenChange,
  fileName,
  incorrect,
  checking,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  incorrect: boolean;
  checking: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password === "" || checking) return;
    onSubmit(password);
    setPassword("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>This PDF needs a password</DialogTitle>
            <DialogDescription>
              “{fileName}” is protected by a password. Enter it to read and mark up the PDF. Composition keeps it in memory only, until you quit the app: it is never saved, so you are asked again next time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              type="password"
              autoFocus
              autoComplete="off"
              aria-label="Password"
              aria-invalid={incorrect}
              value={password}
              disabled={checking}
              onChange={(event) => setPassword(event.target.value)}
            />
            {incorrect && (
              <p role="alert" className="text-sm text-destructive">
                That password is not right. Try again.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={password === "" || checking}>
              {checking ? "Opening…" : "Open"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
