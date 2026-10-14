"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdateState } from "@/components/notes/useUpdateState";
import { describeUpdateState, type UpdateState } from "@/lib/composition/updatesApi";
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setAutoCheckUpdates,
  UPDATES_AVAILABLE,
} from "@/lib/composition/updatesClient";

const SECTION_TITLE = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * The Updates section of the Settings screen. Desktop only: in the web app there is no
 * updater and this renders nothing. The state lives in the app's main process and is pushed
 * here, so this screen only asks for things; it never decides what is downloaded or from where.
 */
export function Updates() {
  const pushed = useUpdateState();
  // What the last button press returned. It stands until the main process pushes something newer
  // (which replaces `pushed`), so the screen is right even if the answer beats the push.
  const [answer, setAnswer] = useState<{ state: UpdateState; after: UpdateState | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!UPDATES_AVAILABLE) return null;
  const state = answer && answer.after === pushed ? answer.state : pushed;
  if (!state) return null;

  function run(action: () => Promise<UpdateState>) {
    setFailure(null);
    startTransition(async () => {
      try {
        setAnswer({ state: await action(), after: pushed });
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    });
  }

  const busy = pending || state.phase === "checking" || state.phase === "downloading";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
          Updates
        </CardTitle>
        <CardDescription>
          Composition looks for a newer version on GitHub when it starts and every few hours. Nothing is downloaded
          until you say so, and the app only restarts when you choose to. Checking contacts github.com; nothing from
          your notes is sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p
          role={state.phase === "error" ? "alert" : "status"}
          className={`break-words ${state.phase === "error" ? "text-destructive" : ""}`}
        >
          {describeUpdateState(state)}
        </p>
        {state.releaseNotes && (state.phase === "available" || state.phase === "ready") && (
          <p className="whitespace-pre-wrap break-words text-muted-foreground">{state.releaseNotes}</p>
        )}
        {failure && (
          <p role="alert" className="break-words text-destructive">
            {failure}
          </p>
        )}

        {state.supported && (
          <>
            <div className="flex flex-wrap gap-2">
              {state.phase === "available" && (
                <Button type="button" size="lg" disabled={busy} onClick={() => run(downloadUpdate)} className="px-4">
                  Download version {state.version}
                </Button>
              )}
              {state.phase === "ready" && (
                <Button type="button" size="lg" disabled={busy} onClick={() => run(installUpdate)} className="px-4">
                  Restart to update
                </Button>
              )}
              {state.phase !== "ready" && (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={busy}
                  onClick={() => run(checkForUpdates)}
                  className="px-4"
                >
                  {state.phase === "checking" ? "Checking…" : "Check for updates"}
                </Button>
              )}
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.autoCheck}
                disabled={pending}
                onChange={(event) => run(() => setAutoCheckUpdates(event.target.checked))}
                className="size-4 accent-primary"
              />
              Check for updates automatically
            </label>
          </>
        )}
      </CardContent>
    </Card>
  );
}
