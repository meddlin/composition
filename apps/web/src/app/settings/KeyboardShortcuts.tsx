"use client";

import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ShortcutList } from "@/components/shortcuts/ShortcutList";
import { useShortcutsHelper } from "@/components/shortcuts/ShortcutsHelper";

/**
 * The Keyboard shortcuts tab of the Settings screen: the full list, plus a button for the
 * floating window that the same list opens in from anywhere in the app.
 */
export function KeyboardShortcuts() {
  const helper = useShortcutsHelper();
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>
          Press <kbd className="rounded border bg-muted px-1 font-mono text-xs">?</kbd> anywhere outside a text
          field, or Cmd/Ctrl+/ from anywhere, to open this list in a floating window.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={helper.show}>
            <ExternalLinkIcon /> Open as window
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ShortcutList />
      </CardContent>
    </Card>
  );
}
