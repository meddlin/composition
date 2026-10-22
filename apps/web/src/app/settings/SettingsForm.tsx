"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveSettings, type SaveSettingsResult } from "@/lib/composition/client";

type Props = {
  currentAppDataDir: string;
  currentDbPath: string;
  derivedDbPathPlaceholder: string;
};

const initialState: SaveSettingsResult = {};

function saveSettingsFromForm(_previous: SaveSettingsResult, formData: FormData) {
  return saveSettings({
    appDataDir: String(formData.get("appDataDir") ?? ""),
    dbPath: String(formData.get("dbPath") ?? ""),
  });
}

export function SettingsForm({ currentAppDataDir, currentDbPath, derivedDbPathPlaceholder }: Props) {
  const [state, formAction, pending] = useActionState(saveSettingsFromForm, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 text-sm">
      <Field className="gap-1">
        <FieldLabel htmlFor="appDataDir">Application data directory</FieldLabel>
        <Input
          id="appDataDir"
          type="text"
          name="appDataDir"
          defaultValue={state.appDataDir ?? currentAppDataDir}
          required
          spellCheck={false}
          className="font-mono"
        />
      </Field>

      <Field className="gap-1">
        <FieldLabel htmlFor="dbPath">Database file location</FieldLabel>
        <FieldDescription className="text-xs">
          Optional — leave blank to use{" "}
          <span className="font-mono">{derivedDbPathPlaceholder}</span>
        </FieldDescription>
        <Input
          id="dbPath"
          type="text"
          name="dbPath"
          defaultValue={state.dbPath ?? currentDbPath}
          placeholder={derivedDbPathPlaceholder}
          spellCheck={false}
          className="font-mono"
        />
      </Field>

      {state.error && <FieldError>{state.error}</FieldError>}
      {state.success && (
        <p role="status" className="text-success">
          Saved. Now reading and writing at the location above.
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending} className="w-fit px-4">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
