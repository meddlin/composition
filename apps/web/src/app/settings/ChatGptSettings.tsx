"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatGptStatus } from "@/lib/composition/assistant/types";
import { chatGptStatus, signOutChatGpt, startChatGptSignIn } from "@/lib/composition/client";

const SECTION_TITLE = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** How often to ask whether the browser has come back, while waiting for it. */
const POLL_MS = 1500;

/**
 * The AI helper's ChatGPT section of the Settings screen: sign in with a ChatGPT account so the helper can answer
 * from the user's plan (no API key), and sign out again. The page is only ever told whether someone is signed in
 * and as whom: the tokens stay in the app's server or main process.
 */
export function ChatGptSettings() {
  const [status, setStatus] = useState<ChatGptStatus | null>(null);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const next = await chatGptStatus();
    if (alive.current) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  // While the approval page is open in the browser, keep asking until it has answered.
  useEffect(() => {
    if (status?.state !== "pending") return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [status?.state, refresh]);

  async function signIn() {
    setBusy(true);
    setProblem(undefined);
    const result = await startChatGptSignIn();
    if (result.error) setProblem(result.error);
    await refresh();
    if (alive.current) setBusy(false);
  }

  async function signOut() {
    setBusy(true);
    setProblem(undefined);
    const result = await signOutChatGpt();
    if (result.error) setProblem(result.error);
    await refresh();
    if (alive.current) setBusy(false);
  }

  const message = problem ?? (status?.state === "signed-out" ? status.error : undefined);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
          ChatGPT
        </CardTitle>
        <CardDescription>
          Let the AI helper answer with ChatGPT, using your ChatGPT plan instead of an API key. It is off until you sign
          in. When you pick a ChatGPT model in the panel, each question sends the note you are in, and any text you have
          selected, to OpenAI. Ollama models stay on your own server. Usage counts against your plan, and you can cap it in
          ChatGPT under Settings &gt; Security and login &gt; Sign in with ChatGPT.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {status === null && <p className="text-muted-foreground">Checking…</p>}

        {status?.state === "signed-in" && (
          <>
            <p role="status" className="break-words text-success">
              Signed in{status.email ? ` as ${status.email}` : ""}. ChatGPT models now appear in the AI helper&apos;s model list.
            </p>
            <div>
              <Button type="button" variant="outline" size="lg" disabled={busy} onClick={signOut} className="px-4">
                Sign out
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Signing out forgets the account on this computer. To also remove this app&apos;s access, remove it in ChatGPT
              under Settings &gt; Security and login &gt; Sign in with ChatGPT.
            </p>
          </>
        )}

        {status?.state === "pending" && (
          <>
            <p role="status" className="text-muted-foreground">
              Waiting for you to approve in your browser…
            </p>
            <div>
              <Button type="button" variant="outline" size="lg" disabled={busy} onClick={signOut} className="px-4">
                Cancel
              </Button>
            </div>
          </>
        )}

        {status?.state === "signed-out" && (
          <>
            <div>
              <Button type="button" size="lg" disabled={busy} onClick={signIn} className="px-4">
                Continue with ChatGPT
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Opens ChatGPT&apos;s approval page in your browser, which sends you back to this computer. It works when this
              app runs on the computer you are using. Needs a ChatGPT Go, Plus or Pro plan.
            </p>
          </>
        )}

        {message && (
          <p role="alert" className="break-words text-destructive">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
