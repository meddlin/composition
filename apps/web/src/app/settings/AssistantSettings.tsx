"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AssistantModels } from "@/lib/composition/api";
import { isLoopback, parseServerUrl } from "@/lib/composition/assistant/serverUrl";
import type { AssistantSettings as Settings } from "@/lib/composition/assistant/settings";
import { listAssistantModels, saveAssistantSettings } from "@/lib/composition/client";

const SECTION_TITLE = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** How many model names to list before saying "and N more". */
const SHOWN_MODELS = 12;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Plain text, shown by React (which escapes it); kept out of the template strings below, which Opengrep reads as HTML.
const PULL_HINT = "Install one with: ollama pull <model>";

function describeModels(found: AssistantModels): string {
  if (found.models.length === 0) {
    return `Reached Ollama at ${found.serverUrl}, but it has no models that can chat. ${PULL_HINT}`;
  }
  const names = found.models.slice(0, SHOWN_MODELS).map((m) => (m.parameterSize ? `${m.name} (${m.parameterSize})` : m.name));
  const more = found.models.length - names.length;
  return `Found ${plural(found.models.length, "model", "models")} on ${found.serverUrl}: ${names.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
}

function describeHidden(count: number): string {
  return count === 1
    ? "1 model that runs on ollama.com was left out."
    : `${count} models that run on ollama.com were left out.`;
}

type Outcome = {
  /** What was just saved, if this outcome follows a save. */
  saved: boolean;
  /** Why the settings were not saved. */
  settingsError?: string;
  /** The result of asking the server for its models. */
  found?: AssistantModels;
};

/**
 * The AI helper's section of the Settings screen: where Ollama is, how large a context window to ask for, and a
 * check that the server answers. Saving also checks the connection, so one click says whether it works.
 */
export function AssistantSettings({ initial }: { initial: Settings }) {
  const [saved, setSaved] = useState(initial);
  const [address, setAddress] = useState(initial.serverUrl);
  const [windowText, setWindowText] = useState(String(initial.contextTokens));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();

  // The last result is about what was saved, so editing a field takes it off the screen.
  function edit(change: () => void) {
    change();
    setOutcome(null);
  }

  const dirty = address !== saved.serverUrl || windowText !== String(saved.contextTokens);

  const entered = parseServerUrl(address);
  const unencrypted = entered.ok && entered.url.startsWith("http:") && !isLoopback(entered.url);

  function submit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const contextTokens = windowText.trim() === "" ? Number.NaN : Number(windowText);
      const result = await saveAssistantSettings({ serverUrl: address, contextTokens });
      if (result.error || !result.settings) {
        setOutcome({ saved: false, settingsError: result.error ?? "The settings could not be saved." });
        return;
      }
      setSaved(result.settings);
      setAddress(result.settings.serverUrl);
      setWindowText(String(result.settings.contextTokens));
      setOutcome({ saved: true, found: await listAssistantModels() });
    });
  }

  function test() {
    startTransition(async () => {
      setOutcome({ saved: false, found: await listAssistantModels() });
    });
  }

  const found = outcome?.found;
  const status = pending
    ? "Checking…"
    : outcome && !outcome.settingsError
      ? [outcome.saved && "Saved.", found && !found.error && describeModels(found)].filter(Boolean).join(" ")
      : "";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className={SECTION_TITLE}>
          AI helper
        </CardTitle>
        <CardDescription>
          A panel beside a note where you can ask a language model running on Ollama for input. Each question sends the
          note you are in, and any text you have selected, to the server below and nowhere else. Models that run on
          ollama.com are hidden, so a note stays on the server you choose.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4 text-sm">
          <Field className="gap-1">
            <FieldLabel htmlFor="assistant-server">Server address</FieldLabel>
            <FieldDescription className="text-xs">
              Where Ollama is running: this computer (the default) or a server you host.
            </FieldDescription>
            <Input
              id="assistant-server"
              type="text"
              value={address}
              onChange={(event) => edit(() => setAddress(event.target.value))}
              placeholder="http://127.0.0.1:11434"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
          {unencrypted && (
            <p className="text-warning">
              This address is not on this computer and is not https, so the notes you send will cross the network
              unencrypted. Use https, or a network you trust.
            </p>
          )}

          <Field className="gap-1">
            <FieldLabel htmlFor="assistant-window">Context size (tokens)</FieldLabel>
            <FieldDescription className="text-xs">
              How much of a note and conversation the model can read at once. Larger needs more memory on the server;
              Ollama quietly drops the oldest text when a conversation outgrows it.
            </FieldDescription>
            <Input
              id="assistant-window"
              type="text"
              inputMode="numeric"
              value={windowText}
              onChange={(event) => edit(() => setWindowText(event.target.value))}
              spellCheck={false}
              className="w-40 font-mono"
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending} className="px-4">
              {pending ? "Checking…" : "Save"}
            </Button>
            <Button type="button" variant="outline" size="lg" disabled={pending || dirty} onClick={test} className="px-4">
              Test connection
            </Button>
          </div>

          {status && (
            <p role="status" className="break-words text-success">
              {status}
            </p>
          )}
          {!pending && found && found.hiddenCloud > 0 && (
            <p className="text-muted-foreground">{describeHidden(found.hiddenCloud)}</p>
          )}
          {!pending && (outcome?.settingsError || found?.error) && (
            <p role="alert" className="break-words text-destructive">
              {outcome?.settingsError ?? found?.error?.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
