"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { saveWritingSettings } from "@/lib/composition/client";
import {
  MAX_WRITING_COLUMN,
  MIN_WRITING_COLUMN,
  validateWritingSettings,
  type WritingSettings as Settings,
} from "@/lib/composition/writing";

/** The columns are typed as text, so a half-typed or empty field can be shown and fixed. */
type Draft = {
  rulerEnabled: boolean;
  rulerColumn: string;
  reflowEnabled: boolean;
  reflowColumn: string;
  reflowKeepsTables: boolean;
  wordCountEnabled: boolean;
};

const toDraft = (settings: Settings): Draft => ({
  ...settings,
  rulerColumn: String(settings.rulerColumn),
  reflowColumn: String(settings.reflowColumn),
});

const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

/**
 * The Markdown editor's writing aids: a ruler to guide the eye, and reflow, which breaks lines at a
 * column as they are typed. Changes reach the editor when you go back to your notes.
 */
export function WritingSettings({ initial }: { initial: Settings }) {
  const [draft, setDraft] = useState<Draft>(toDraft(initial));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // What was saved is no longer what is on screen once a field changes.
  function edit(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }));
    setSaved(false);
    setError(undefined);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const checked = validateWritingSettings({
      ...draft,
      rulerColumn: toNumber(draft.rulerColumn),
      reflowColumn: toNumber(draft.reflowColumn),
    });
    if (!checked.settings) {
      setError(checked.error);
      return;
    }
    const settings = checked.settings;
    startTransition(async () => {
      const result = await saveWritingSettings(settings);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDraft(toDraft(settings));
      setSaved(true);
    });
  }

  const columnHint = `${MIN_WRITING_COLUMN}–${MAX_WRITING_COLUMN} characters`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 text-sm">
      <FieldSet className="gap-2">
        <FieldLegend variant="label">Ruler</FieldLegend>
        <FieldDescription className="text-xs">
          A thin vertical line in the Markdown tab at a column you choose, to see how long lines are running. It is
          only a guide and never changes your text. In a proportional font the column is approximate.
        </FieldDescription>
        <Field orientation="horizontal" className="w-fit gap-3">
          <Checkbox
            id="ruler-enabled"
            checked={draft.rulerEnabled}
            onCheckedChange={(checked) => edit({ rulerEnabled: checked === true })}
          />
          <FieldLabel htmlFor="ruler-enabled" className="cursor-pointer font-normal">
            Show the ruler
          </FieldLabel>
        </Field>
        <Field className="gap-1">
          <FieldLabel htmlFor="ruler-column">Ruler column</FieldLabel>
          <Input
            id="ruler-column"
            type="text"
            inputMode="numeric"
            value={draft.rulerColumn}
            onChange={(event) => edit({ rulerColumn: event.target.value })}
            disabled={!draft.rulerEnabled}
            aria-describedby="ruler-column-hint"
            spellCheck={false}
            className="w-24 font-mono"
          />
          <FieldDescription id="ruler-column-hint" className="text-xs">
            {columnHint}
          </FieldDescription>
        </Field>
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Reflow</FieldLegend>
        <FieldDescription className="text-xs">
          As you type, a line that runs past the column is broken at the last space before it, and the rest carries on
          below, lined up under a list item or quote. Only the line you are typing changes. Headings, code, HTML and
          the note&apos;s frontmatter are never broken, and neither is a single long word or link.
        </FieldDescription>
        <Field orientation="horizontal" className="w-fit gap-3">
          <Checkbox
            id="reflow-enabled"
            checked={draft.reflowEnabled}
            onCheckedChange={(checked) => edit({ reflowEnabled: checked === true })}
          />
          <FieldLabel htmlFor="reflow-enabled" className="cursor-pointer font-normal">
            Break lines as I type
          </FieldLabel>
        </Field>
        <Field className="gap-1">
          <FieldLabel htmlFor="reflow-column">Reflow column</FieldLabel>
          <Input
            id="reflow-column"
            type="text"
            inputMode="numeric"
            value={draft.reflowColumn}
            onChange={(event) => edit({ reflowColumn: event.target.value })}
            disabled={!draft.reflowEnabled}
            aria-describedby="reflow-column-hint"
            spellCheck={false}
            className="w-24 font-mono"
          />
          <FieldDescription id="reflow-column-hint" className="text-xs">
            {columnHint}
          </FieldDescription>
        </Field>
        <Field orientation="horizontal" className="w-fit items-start gap-3">
          <Checkbox
            id="reflow-tables"
            checked={draft.reflowKeepsTables}
            onCheckedChange={(checked) => edit({ reflowKeepsTables: checked === true })}
            disabled={!draft.reflowEnabled}
            aria-describedby="reflow-tables-hint"
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="reflow-tables" className="cursor-pointer font-normal">
              Keep Markdown tables intact
            </FieldLabel>
            <FieldDescription id="reflow-tables-hint" className="text-xs">
              A table row has to stay on one line to stay a table, so rows are never broken. Turn this off to break them
              like any other line.
            </FieldDescription>
          </div>
        </Field>
      </FieldSet>

      <FieldSet className="gap-2">
        <FieldLegend variant="label">Word count</FieldLegend>
        <FieldDescription className="text-xs">
          A live count of the words in the note you are writing, shown in the bar below it beside the attachments. The
          note&apos;s frontmatter is not counted.
        </FieldDescription>
        <Field orientation="horizontal" className="w-fit gap-3">
          <Checkbox
            id="word-count-enabled"
            checked={draft.wordCountEnabled}
            onCheckedChange={(checked) => edit({ wordCountEnabled: checked === true })}
          />
          <FieldLabel htmlFor="word-count-enabled" className="cursor-pointer font-normal">
            Show the word count
          </FieldLabel>
        </Field>
      </FieldSet>

      {error && <FieldError>{error}</FieldError>}
      {saved && (
        <p role="status" className="text-success">
          Saved. It applies when you go back to your notes.
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending} className="w-fit px-4">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
