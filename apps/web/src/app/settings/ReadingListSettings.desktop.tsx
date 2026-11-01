"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError } from "@/components/ui/field";
import { clearReadingData } from "@/lib/composition/readingListClient";
import { useSettingsPluginEnabled } from "./PluginsProvider";

/**
 * Settings > Plugins, under the Reading List: wipes what the pages stored (sign-ins, cookies, cache). The links are kept. It
 * belongs to the Reading List plugin, so it is not shown while the plugin is off; the browsing data itself is kept while
 * it is off, and this is the way to wipe it. (The web app has no Reading List; see `ReadingListSettings.tsx`.)
 */
export function ReadingListSettings() {
  return useSettingsPluginEnabled("reading-list") ? <ClearBrowsingData /> : null;
}

function ClearBrowsingData() {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();

  async function clear() {
    setAsking(false);
    setBusy(true);
    setError(undefined);
    setDone(false);
    try {
      await clearReadingData();
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The browsing data could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field orientation="horizontal" className="pl-7">
      <FieldContent>
        <FieldDescription>
          Pages in the Reading List keep their sign-ins, cookies and cache between visits, apart from the rest of the app. Your links are not affected.
        </FieldDescription>
        {error && <FieldError>{error}</FieldError>}
        {done && <FieldDescription role="status">Browsing data cleared.</FieldDescription>}
      </FieldContent>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setAsking(true)}>
        Clear browsing data
      </Button>
      <ConfirmDialog
        open={asking}
        title="Clear browsing data?"
        description="You will be signed out of every site you signed in to in the Reading List, and its cookies and cache are deleted. Your links are kept."
        confirmLabel="Clear"
        onCancel={() => setAsking(false)}
        onConfirm={() => void clear()}
      />
    </Field>
  );
}
