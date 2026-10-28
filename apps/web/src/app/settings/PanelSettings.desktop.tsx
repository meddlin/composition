"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { setWarnDuplicateNotePanels, useWarnDuplicateNotePanels } from "@/components/panels/panelPrefs";

/** The desktop app's panel preferences. (The web app has no panels; see `PanelSettings.tsx`.) */
export function PanelSettings() {
  const warn = useWarnDuplicateNotePanels();

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Panels
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal">
          <Checkbox
            id="warn-duplicate-note-panels"
            checked={warn}
            onCheckedChange={(checked) => setWarnDuplicateNotePanels(checked === true)}
          />
          <FieldContent>
            <FieldLabel htmlFor="warn-duplicate-note-panels">Warn when a note is opened in more than one panel</FieldLabel>
            <FieldDescription>
              Opening a note to the side, or dropping it on a panel, asks first if it is already open. The warning has a
              box to stop it; this turns it back on.
            </FieldDescription>
          </FieldContent>
        </Field>
      </CardContent>
    </Card>
  );
}
