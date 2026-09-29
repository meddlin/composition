"use client";

import { useActionState } from "react";
import { saveSettingsAction, type SettingsFormState } from "./actions";

type Props = {
  currentAppDataDir: string;
  currentDbPath: string;
  derivedDbPathPlaceholder: string;
};

const initialState: SettingsFormState = {};

export function SettingsForm({
  currentAppDataDir,
  currentDbPath,
  derivedDbPathPlaceholder,
}: Props) {
  const [state, formAction, pending] = useActionState(saveSettingsAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">Application data directory</span>
        <input
          type="text"
          name="appDataDir"
          defaultValue={state.appDataDir ?? currentAppDataDir}
          required
          spellCheck={false}
          className="rounded-md border border-foreground/15 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-foreground/40"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-medium">Database file location</span>
        <span className="text-xs text-foreground/50">
          Optional — leave blank to use{" "}
          <span className="font-mono">{derivedDbPathPlaceholder}</span>
        </span>
        <input
          type="text"
          name="dbPath"
          defaultValue={state.dbPath ?? currentDbPath}
          placeholder={derivedDbPathPlaceholder}
          spellCheck={false}
          className="rounded-md border border-foreground/15 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-foreground/40"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-green-600 dark:text-green-400">
          Saved. Now reading and writing at the location above.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
