"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { usePlugins } from "@/components/plugins/usePlugins";
import { LAUNCHERS, isKindAvailable } from "@/components/panels/launchers";
import {
  setRailKindHidden,
  setShowPluginRail,
  setWarnDuplicateNotePanels,
  useHiddenRailKinds,
  useShowPluginRail,
  useWarnDuplicateNotePanels,
} from "@/components/panels/panelPrefs";
import { usePluginsStore } from "./PluginsProvider";

/** The desktop app's panel preferences. (The web app has no panels; see `PanelSettings.tsx`.) */
export function PanelSettings() {
  const warn = useWarnDuplicateNotePanels();
  const showRail = useShowPluginRail();
  const hidden = useHiddenRailKinds();
  const { enabled } = usePlugins(usePluginsStore());

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Panels
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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

        <Field orientation="horizontal">
          <Checkbox id="show-plugin-rail" checked={showRail} onCheckedChange={(checked) => setShowPluginRail(checked === true)} />
          <FieldContent>
            <FieldLabel htmlFor="show-plugin-rail">Show the plugin rail</FieldLabel>
            <FieldDescription>
              A narrow column of icons beside the notebooks that open the AI helper, to-do list and the other panels. Turn it
              off to save the space if you open panels from the command palette (Cmd/Ctrl+Shift+P); every panel can still be
              opened from there, and from an empty panel.
            </FieldDescription>
          </FieldContent>
        </Field>

        <FieldSet>
          <FieldLegend variant="label">Icons in the plugin rail</FieldLegend>
          <FieldDescription>
            Taking an icon off the rail does not turn its plugin off; its panel is still in the palette. An icon for a plugin
            that is turned off is not shown, whatever is chosen here.
          </FieldDescription>
          {LAUNCHERS.map(({ kind, label }) => {
            const pluginOn = isKindAvailable(kind, enabled);
            return (
              <Field key={kind} orientation="horizontal">
                <Checkbox
                  id={`rail-${kind}`}
                  checked={!hidden.includes(kind)}
                  disabled={!showRail || !pluginOn}
                  onCheckedChange={(checked) => setRailKindHidden(kind, checked !== true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`rail-${kind}`}>{label}</FieldLabel>
                  {!pluginOn && <FieldDescription>The plugin is turned off.</FieldDescription>}
                </FieldContent>
              </Field>
            );
          })}
        </FieldSet>
      </CardContent>
    </Card>
  );
}
