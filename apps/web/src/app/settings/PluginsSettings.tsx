"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { usePlugins } from "@/components/plugins/usePlugins";
import { PLUGINS, pluginRunsIn } from "@/lib/composition/plugins";
import { PLUGIN_HOST } from "@/lib/composition/pluginHost";
import { usePluginsStore } from "./PluginsProvider";
import { ReadingListSettings } from "./ReadingListSettings";

/**
 * Settings > Plugins: the built-in plugins, each on or off. A change shows at once and is saved in the background, like
 * the styling choices. A plugin that is off keeps everything it stored.
 */
export function PluginsSettings() {
  const store = usePluginsStore();
  const { enabled, error } = usePlugins(store);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Built-in plugins
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {PLUGINS.map((plugin) => {
          const { id, name, description } = plugin;
          const available = pluginRunsIn(plugin, PLUGIN_HOST);
          return (
            <div key={id} className="flex flex-col gap-3">
              <Field orientation="horizontal">
                <Checkbox
                  id={`plugin-${id}`}
                  checked={enabled[id]}
                  disabled={!available}
                  onCheckedChange={(checked) => void store.setEnabled(id, checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`plugin-${id}`}>{name}</FieldLabel>
                  <FieldDescription>
                    {description}
                    {!available && <> Only available in the desktop app.</>}
                  </FieldDescription>
                </FieldContent>
              </Field>
              {id === "reading-list" && <ReadingListSettings />}
            </div>
          );
        })}
        {error && <FieldError>{error}</FieldError>}
      </CardContent>
    </Card>
  );
}
